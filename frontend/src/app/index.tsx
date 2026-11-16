
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Linking,
} from 'react-native';
import * as Location from 'expo-location';

const API = 'http://127.0.0.1:8001';
type User = {
  id: number;
  name: string;
  email: string;
  phone: string;
};

type Contact = {
  id: number;
  name: string;
  phone: string;
  email: string | null;
  consent_confirmed: boolean;
};

type CurrentLocation = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
};

export default function HomeScreen() {
  const [isRegister, setIsRegister] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('+91');
  const [password, setPassword] = useState('');

  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState('');

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('+91');
  const [contactEmail, setContactEmail] = useState('');
  const [consent, setConsent] = useState(false);

  // SOS countdown and active incident
  const [sosCountdown, setSosCountdown] = useState<number | null>(null);
  const [sosBusy, setSosBusy] = useState(false);
  const [sosResult, setSosResult] = useState('');
  const [activeIncidentId, setActiveIncidentId] = useState<number | null>(null);
  const activeIncidentIdRef = useRef<number | null>(null);
  const cancelSosRef = useRef(false);

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  // Current GPS location
  const [location, setLocation] = useState<CurrentLocation | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationError, setLocationError] = useState('');

  // Live tracking
  const [isTracking, setIsTracking] = useState(false);
  const trackingSubscription =
    useRef<Location.LocationSubscription | null>(null);

  // Stop GPS tracking when the screen is removed
  useEffect(() => {
    return () => {
      trackingSubscription.current?.remove();
      trackingSubscription.current = null;
    };
  }, []);

  // API request helper
  async function request(
    path: string,
    method = 'GET',
    body?: object,
    authToken?: string
  ) {
    const response = await fetch(`${API}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(authToken
          ? { Authorization: `Bearer ${authToken}` }
          : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        typeof data.detail === 'string'
          ? data.detail
          : JSON.stringify(data.detail || 'Request failed')
      );
    }

    return data;
  }

  // Load emergency contacts
  async function loadContacts(authToken: string) {
    const data = await request(
      '/api/contacts',
      'GET',
      undefined,
      authToken
    );
    setContacts(data);
  }

  // Registration and login
  async function handleAuth() {
    setMessage('');

    if (!email.trim() || !password) {
      setMessage('Please enter your email and password.');
      return;
    }

    if (isRegister && (!name.trim() || !phone.trim())) {
      setMessage('Please enter your name and phone number.');
      return;
    }

    setLoading(true);

    try {
      const endpoint = isRegister
        ? '/api/auth/register'
        : '/api/auth/login';

      const payload = isRegister
        ? {
            name: name.trim(),
            email: email.trim(),
            phone: phone.trim(),
            password,
          }
        : {
            email: email.trim(),
            password,
          };

      const data = await request(endpoint, 'POST', payload);

      setToken(data.access_token);
      setUser(data.user);

      await loadContacts(data.access_token);

      setLoggedIn(true);
      setPassword('');
      setMessage('');
    } catch (error: any) {
      setMessage(error.message || 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  }

  // Add emergency contact
  async function addContact() {
    setMessage('');

    if (!contactName.trim() || !contactPhone.trim() || !contactEmail.trim()) {
      setMessage('Enter the contact name, phone number, and email address.');
      return;
    }

    if (!consent) {
      setMessage('Please confirm that this contact has consented.');
      return;
    }

    setLoading(true);

    try {
      const newContact = await request(
        '/api/contacts',
        'POST',
        {
          name: contactName.trim(),
          phone: contactPhone.trim(),
          email: contactEmail.trim().toLowerCase(),
          consent_confirmed: true,
        },
        token
      );

      setContacts(previous => [...previous, newContact]);
      setContactName('');
      setContactPhone('+91');
      setContactEmail('');
      setConsent(false);
      setMessage('Emergency contact added successfully.');
    } catch (error: any) {
      setMessage(error.message || 'Could not add contact.');
    } finally {
      setLoading(false);
    }
  }

  // Delete emergency contact
  async function deleteContact(id: number) {
    setMessage('');

    try {
      await request(
        `/api/contacts/${id}`,
        'DELETE',
        undefined,
        token
      );

      setContacts(previous =>
        previous.filter(contact => contact.id !== id)
      );

      setMessage('Contact deleted.');
    } catch (error: any) {
      setMessage(error.message || 'Could not delete contact.');
    }
  }

  // Get one current GPS location
  async function getCurrentLocation() {
    setLocationLoading(true);
    setLocationError('');
    setMessage('');

    try {
      const permission =
        await Location.requestForegroundPermissionsAsync();

      if (permission.status !== 'granted') {
        throw new Error('Please allow location permission.');
      }

      const result = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      setLocation({
        latitude: result.coords.latitude,
        longitude: result.coords.longitude,
        accuracy: result.coords.accuracy,
      });
    } catch (error: any) {
      setLocationError(
        error.message || 'Unable to get your current location.'
      );
    } finally {
      setLocationLoading(false);
    }
  }

  // Start automatic foreground GPS tracking
  async function startLiveTracking() {
    setLocationError('');

    try {
      if (trackingSubscription.current) {
        return;
      }

      const permission =
        await Location.requestForegroundPermissionsAsync();

      if (permission.status !== 'granted') {
        throw new Error('Location permission is required.');
      }

      const subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 3000,
          distanceInterval: 5,
        },
        result => {
          const updatedLocation: CurrentLocation = {
            latitude: result.coords.latitude,
            longitude: result.coords.longitude,
            accuracy: result.coords.accuracy,
          };

          setLocation(updatedLocation);

          // Once SOS is active, send each foreground GPS update to the backend.
          const incidentId = activeIncidentIdRef.current;
          if (incidentId !== null) {
            request(
              `/api/incidents/${incidentId}/location`,
              'POST',
              {
                latitude: updatedLocation.latitude,
                longitude: updatedLocation.longitude,
                accuracy_m: updatedLocation.accuracy,
              },
              token
            ).catch(error => {
              console.warn('Could not upload live location:', error);
            });
          }
        }
      );

      trackingSubscription.current = subscription;
      setIsTracking(true);
    } catch (error: any) {
      setLocationError(
        error.message || 'Could not start live tracking.'
      );
    }
  }

  // Stop automatic GPS tracking
  function stopLiveTracking() {
    trackingSubscription.current?.remove();
    trackingSubscription.current = null;
    setIsTracking(false);
  }

  // Start SOS after a short, cancellable countdown.
  async function beginSosCountdown() {
    if (sosBusy || activeIncidentIdRef.current !== null) return;

    if (contacts.length === 0) {
      setSosResult('Add at least one consenting emergency contact first.');
      return;
    }

    cancelSosRef.current = false;
    setSosResult('');
    setSosBusy(true);

    for (let seconds = 5; seconds > 0; seconds--) {
      if (cancelSosRef.current) {
        setSosCountdown(null);
        setSosBusy(false);
        setSosResult('SOS cancelled.');
        return;
      }
      setSosCountdown(seconds);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    setSosCountdown(null);

    if (cancelSosRef.current) {
      setSosBusy(false);
      setSosResult('SOS cancelled.');
      return;
    }

    try {
      let current = location;

      if (!current) {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status !== 'granted') {
          throw new Error('Location permission is required to send SOS.');
        }
        const result = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
        current = {
          latitude: result.coords.latitude,
          longitude: result.coords.longitude,
          accuracy: result.coords.accuracy,
        };
        setLocation(current);
      }

      const result = await request(
        '/api/sos',
        'POST',
        {
          latitude: current.latitude,
          longitude: current.longitude,
          accuracy_m: current.accuracy,
        },
        token
      );

      activeIncidentIdRef.current = result.incident_id;
      setActiveIncidentId(result.incident_id);
      setSosResult(
        `SOS created. Email status: ${result.email_status}. Check recipient results and verify that contacts receive the email.`
      );

      // Begin foreground tracking so subsequent GPS fixes are uploaded.
      await startLiveTracking();
    } catch (error: any) {
      setSosResult(error.message || 'Could not activate SOS.');
    } finally {
      setSosBusy(false);
    }
  }

  function cancelSosCountdown() {
    cancelSosRef.current = true;
    setSosCountdown(null);
  }

  async function stopSosIncident() {
    const incidentId = activeIncidentIdRef.current;
    if (incidentId === null) return;

    try {
      await request(
        `/api/incidents/${incidentId}/stop`,
        'POST',
        undefined,
        token
      );
      activeIncidentIdRef.current = null;
      setActiveIncidentId(null);
      stopLiveTracking();
      setSosResult('SOS incident stopped. Live location sharing has ended.');
    } catch (error: any) {
      setSosResult(error.message || 'Could not stop SOS incident.');
    }
  }

  async function callEmergencyNumber() {
    try {
      await Linking.openURL('tel:112');
    } catch {
      setSosResult('Could not open the phone dialler. Please call 112 manually.');
    }
  }

  // Open location in Google Maps
  async function openGoogleMaps() {
    if (!location) return;

    const url =
      `https://www.google.com/maps?q=${location.latitude},${location.longitude}`;

    try {
      await Linking.openURL(url);
    } catch {
      setLocationError('Could not open Google Maps.');
    }
  }

  // Logout
  function logout() {
    stopLiveTracking();

    setLoggedIn(false);
    setToken('');
    setUser(null);
    setContacts([]);
    setLocation(null);
    setLocationError('');
    setMessage('');
    setPassword('');
    activeIncidentIdRef.current = null;
    setActiveIncidentId(null);
    setSosResult('');
    setSosCountdown(null);
    cancelSosRef.current = true;
  }

  // Reusable button
  function ActionButton({
    title,
    onPress,
    disabled = false,
    secondary = false,
  }: {
    title: string;
    onPress: () => void;
    disabled?: boolean;
    secondary?: boolean;
  }) {
    return (
      <Pressable
        onPress={onPress}
        disabled={disabled}
        style={[
          styles.button,
          secondary && styles.secondaryButton,
          disabled && styles.disabledButton,
        ]}
      >
        <Text
          style={[
            styles.buttonText,
            secondary && styles.secondaryButtonText,
          ]}
        >
          {title}
        </Text>
      </Pressable>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.logo}>SafeHer</Text>
        <Text style={styles.subtitle}>
          Your safety. Your control.
        </Text>

        {!loggedIn ? (
          <View style={styles.card}>
            <Text style={styles.heading}>
              {isRegister ? 'Create Account' : 'Welcome Back'}
            </Text>

            {isRegister && (
              <>
                <Text style={styles.label}>Full Name</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter your name"
                  value={name}
                  onChangeText={setName}
                />

                <Text style={styles.label}>Phone Number</Text>
                <TextInput
                  style={styles.input}
                  placeholder="+91XXXXXXXXXX"
                  value={phone}
                  onChangeText={setPhone}
                  keyboardType="phone-pad"
                />
              </>
            )}

            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your email"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />

            {message ? (
              <Text style={styles.message}>{message}</Text>
            ) : null}

            <ActionButton
              title={
                loading
                  ? 'Please wait...'
                  : isRegister
                    ? 'Create Account'
                    : 'Login'
              }
              onPress={handleAuth}
              disabled={loading}
            />

            <Pressable
              onPress={() => {
                setIsRegister(!isRegister);
                setMessage('');
              }}
              style={styles.switchButton}
            >
              <Text style={styles.switchText}>
                {isRegister
                  ? 'Already have an account? Login'
                  : "Don't have an account? Register"}
              </Text>
            </Pressable>
          </View>
        ) : (
          <>
            {/* USER PROFILE */}
            <View style={styles.card}>
              <Text style={styles.heading}>
                Welcome, {user?.name}
              </Text>

              <Text style={styles.profileText}>{user?.email}</Text>
              <Text style={styles.profileText}>{user?.phone}</Text>

              <Pressable
                onPress={logout}
                style={styles.logoutButton}
              >
                <Text style={styles.logoutText}>Logout</Text>
              </Pressable>
            </View>

            {/* GPS AND LIVE TRACKING */}
            <View style={styles.card}>
              <Text style={styles.heading}>Live Location Tracking</Text>

              <Text style={styles.description}>
                Start tracking to automatically refresh your location
                while SafeHer is open.
              </Text>

              <View
                style={[
                  styles.statusBox,
                  isTracking
                    ? styles.trackingStatus
                    : styles.stoppedStatus,
                ]}
              >
                <View
                  style={[
                    styles.statusDot,
                    isTracking
                      ? styles.activeDot
                      : styles.inactiveDot,
                  ]}
                />

                <Text style={styles.statusText}>
                  {isTracking
                    ? 'LIVE TRACKING ACTIVE'
                    : 'LIVE TRACKING STOPPED'}
                </Text>
              </View>

              {!isTracking ? (
                <ActionButton
                  title="Start Live Tracking"
                  onPress={startLiveTracking}
                />
              ) : (
                <ActionButton
                  title="Stop Live Tracking"
                  onPress={stopLiveTracking}
                  secondary
                />
              )}

              <ActionButton
                title={
                  locationLoading
                    ? 'Getting Location...'
                    : 'Get Current Location'
                }
                onPress={getCurrentLocation}
                disabled={locationLoading}
                secondary
              />

              {locationLoading && (
                <ActivityIndicator
                  size="large"
                  color="#C2185B"
                  style={styles.loader}
                />
              )}

              {locationError ? (
                <Text style={styles.error}>{locationError}</Text>
              ) : null}

              {location ? (
                <View style={styles.locationDetails}>
                  <Text style={styles.locationTitle}>
                    {isTracking
                      ? 'Latest Live Coordinates'
                      : 'Current Coordinates'}
                  </Text>

                  <Text style={styles.detailText}>
                    Latitude: {location.latitude.toFixed(6)}
                  </Text>

                  <Text style={styles.detailText}>
                    Longitude: {location.longitude.toFixed(6)}
                  </Text>

                  <Text style={styles.detailText}>
                    Accuracy:{' '}
                    {location.accuracy == null
                      ? 'Not available'
                      : `±${Math.round(location.accuracy)} metres`}
                  </Text>

                  <ActionButton
                    title="Open in Google Maps"
                    onPress={openGoogleMaps}
                  />
                </View>
              ) : (
                <Text style={styles.emptyText}>
                  Your location will appear here after GPS is retrieved.
                </Text>
              )}

              <Text style={styles.note}>
                This is foreground tracking only. Tracking stops when
                you stop it or leave the screen. It does not yet send
                your location to emergency contacts.
              </Text>
            </View>

            {/* SOS AND EMERGENCY CALL */}
            <View style={styles.card}>
              <Text style={styles.heading}>Emergency SOS</Text>
              <Text style={styles.description}>
                Press SOS to start a 5-second countdown. You can cancel before
                the alert is sent. SafeHer will email your consenting contacts
                with your initial location and a tracking link.
              </Text>

              {activeIncidentId === null ? (
                sosCountdown === null ? (
                  <ActionButton
                    title={sosBusy ? 'Preparing SOS...' : 'ACTIVATE SOS'}
                    onPress={beginSosCountdown}
                    disabled={sosBusy || contacts.length === 0}
                  />
                ) : (
                  <>
                    <Text style={styles.sosCountdown}>
                      SOS sends in {sosCountdown}...
                    </Text>
                    <ActionButton
                      title="CANCEL SOS"
                      onPress={cancelSosCountdown}
                      secondary
                    />
                  </>
                )
              ) : (
                <ActionButton
                  title="STOP SOS AND LOCATION SHARING"
                  onPress={stopSosIncident}
                  secondary
                />
              )}

              <ActionButton
                title="CALL EMERGENCY SERVICES — 112"
                onPress={callEmergencyNumber}
                secondary
              />

              {sosResult ? (
                <Text style={styles.message}>{sosResult}</Text>
              ) : null}

              <Text style={styles.note}>
                SOS email delivery and live GPS updates require internet access.
                Foreground tracking works only while the app remains open; this
                is not background tracking and does not automatically contact
                police or emergency services.
              </Text>
            </View>

            {/* EMERGENCY CONTACTS */}
            <View style={styles.card}>
              <Text style={styles.heading}>Emergency Contacts</Text>

              <Text style={styles.description}>
                Add trusted people who may be contacted in an emergency.
              </Text>

              <Text style={styles.label}>Contact Name</Text>
              <TextInput
                style={styles.input}
                placeholder="Enter contact name"
                value={contactName}
                onChangeText={setContactName}
              />

              <Text style={styles.label}>Phone Number</Text>
              <TextInput
                style={styles.input}
                placeholder="+91XXXXXXXXXX"
                value={contactPhone}
                onChangeText={setContactPhone}
                keyboardType="phone-pad"
              />

              <Text style={styles.label}>Email Address</Text>
              <TextInput
                style={styles.input}
                placeholder="contact@example.com"
                value={contactEmail}
                onChangeText={setContactEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />

              <Pressable
                style={styles.consentRow}
                onPress={() => setConsent(!consent)}
              >
                <View
                  style={[
                    styles.checkbox,
                    consent && styles.checkedBox,
                  ]}
                >
                  {consent && (
                    <Text style={styles.checkmark}>✓</Text>
                  )}
                </View>

                <Text style={styles.consentText}>
                  I confirm that this person has agreed to be my
                  emergency contact.
                </Text>
              </Pressable>

              <ActionButton
                title={
                  loading
                    ? 'Please wait...'
                    : 'Add Emergency Contact'
                }
                onPress={addContact}
                disabled={loading}
              />

              {message ? (
                <Text style={styles.message}>{message}</Text>
              ) : null}

              <Text style={styles.subheading}>
                Your Saved Contacts ({contacts.length})
              </Text>

              {contacts.length === 0 ? (
                <Text style={styles.emptyText}>
                  No emergency contacts added yet.
                </Text>
              ) : (
                contacts.map(contact => (
                  <View key={contact.id} style={styles.contactItem}>
                    <View style={styles.contactInfo}>
                      <Text style={styles.contactName}>
                        {contact.name}
                      </Text>

                      <Text style={styles.contactPhone}>
                        {contact.phone}
                      </Text>
                      <Text style={styles.contactPhone}>
                        {contact.email || 'No email saved'}
                      </Text>
                    </View>

                    <Pressable
                      onPress={() => deleteContact(contact.id)}
                      style={styles.deleteButton}
                    >
                      <Text style={styles.deleteText}>Delete</Text>
                    </Pressable>
                  </View>
                ))
              )}
            </View>
          </>
        )}

        <Text style={styles.footer}>
          SafeHer • Stay aware. Stay safe.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#FFF4F7',
  },
  container: {
    flexGrow: 1,
    padding: 20,
    paddingTop: 45,
    alignItems: 'center',
  },
  logo: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#C2185B',
  },
  subtitle: {
    color: '#777',
    fontSize: 15,
    marginBottom: 25,
  },
  card: {
    width: '100%',
    maxWidth: 520,
    backgroundColor: '#FFFFFF',
    padding: 22,
    borderRadius: 18,
    marginBottom: 20,
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  heading: {
    fontSize: 23,
    fontWeight: 'bold',
    color: '#C2185B',
    marginBottom: 14,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#444',
    marginBottom: 7,
    marginTop: 12,
  },
  input: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#E5C8D3',
    borderRadius: 10,
    padding: 13,
    fontSize: 15,
    backgroundColor: '#FFFBFC',
  },
  button: {
    backgroundColor: '#C2185B',
    padding: 15,
    borderRadius: 11,
    alignItems: 'center',
    marginTop: 17,
  },
  secondaryButton: {
    backgroundColor: '#FCE4EC',
    borderWidth: 1,
    borderColor: '#E8B7C9',
  },
  disabledButton: {
    opacity: 0.55,
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 15,
  },
  secondaryButtonText: {
    color: '#C2185B',
  },
  switchButton: {
    marginTop: 18,
    alignItems: 'center',
  },
  switchText: {
    color: '#C2185B',
    fontWeight: '600',
  },
  message: {
    color: '#C2185B',
    marginTop: 12,
    fontSize: 13,
  },
  error: {
    color: '#B00020',
    marginTop: 12,
    lineHeight: 20,
  },
  profileText: {
    fontSize: 14,
    color: '#666',
    marginBottom: 5,
  },
  logoutButton: {
    alignSelf: 'flex-end',
    marginTop: 12,
    padding: 8,
  },
  logoutText: {
    color: '#C2185B',
    fontWeight: 'bold',
  },
  description: {
    color: '#666',
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 8,
  },
  sosCountdown: {
    color: '#B00020',
    fontSize: 22,
    fontWeight: 'bold',
    textAlign: 'center',
    marginTop: 18,
  },
  statusBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    marginTop: 10,
  },
  trackingStatus: {
    backgroundColor: '#E7F6EC',
  },
  stoppedStatus: {
    backgroundColor: '#F3F3F3',
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 10,
  },
  activeDot: {
    backgroundColor: '#1B9B50',
  },
  inactiveDot: {
    backgroundColor: '#999999',
  },
  statusText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#444',
  },
  loader: {
    marginTop: 15,
  },
  locationDetails: {
    marginTop: 18,
    padding: 14,
    backgroundColor: '#FFF4F7',
    borderRadius: 12,
  },
  locationTitle: {
    color: '#237A45',
    fontWeight: 'bold',
    marginBottom: 10,
  },
  detailText: {
    color: '#444',
    fontSize: 14,
    marginBottom: 8,
  },
  note: {
    color: '#777',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 15,
  },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 15,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderWidth: 1,
    borderColor: '#C2185B',
    borderRadius: 5,
    marginRight: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkedBox: {
    backgroundColor: '#C2185B',
  },
  checkmark: {
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  consentText: {
    flex: 1,
    color: '#555',
    fontSize: 13,
    lineHeight: 19,
  },
  subheading: {
    fontSize: 17,
    fontWeight: 'bold',
    marginTop: 25,
    marginBottom: 12,
    color: '#333',
  },
  emptyText: {
    color: '#888',
    fontSize: 14,
    marginTop: 10,
  },
  contactItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: '#F0E2E7',
  },
  contactInfo: {
    flex: 1,
  },
  contactName: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#333',
  },
  contactPhone: {
    fontSize: 13,
    color: '#777',
    marginTop: 4,
  },
  deleteButton: {
    padding: 9,
    backgroundColor: '#FCE4EC',
    borderRadius: 8,
  },
  deleteText: {
    color: '#C2185B',
    fontWeight: 'bold',
  },
  footer: {
    color: '#999',
    fontSize: 12,
    marginTop: 10,
    marginBottom: 20,
  },
});
