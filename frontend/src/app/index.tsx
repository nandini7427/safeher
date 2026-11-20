
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
import { startBrowserEvidenceRecording, stopBrowserEvidenceRecording } from './evidenceRecorder';
import { enableHelpVoiceTrigger, disableHelpVoiceTrigger } from './voiceTrigger';
import { listLocalEvidence, getLocalEvidence } from './evidenceStorage';

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
  const [activeSection, setActiveSection] = useState<'home' | 'sos' | 'location' | 'contacts' | 'profile' | 'evidence'>('home');

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
  const [evidenceStatus, setEvidenceStatus] = useState('Evidence recording has not started.');
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState('Voice activation is off.');
  const [localEvidence, setLocalEvidence] = useState<any[]>([]);
  const [serverEvidence, setServerEvidence] = useState<any[]>([]);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [evidenceError, setEvidenceError] = useState('');
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

  // Check SOS email notification status without blocking GPS or recording.
  async function checkSosEmailStatus(
    incidentId: number,
    authToken: string
  ) {
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        const result = await request(
          `/api/incidents/${incidentId}/notification-status`,
          'GET',
          undefined,
          authToken
        );

        const status = result.email_status;

        if (status === 'sent') {
          setSosResult(
            'SOS is active. Gmail accepted the emergency email for sending. This does not confirm inbox delivery.'
          );
          return;
        }

        if (status === 'failed') {
          setSosResult(
            'SOS is active, but the emergency email notification failed. Please contact your emergency contacts directly.'
          );
          return;
        }

        if (status === 'not_configured') {
          setSosResult(
            'SOS is active, but email notifications are not configured. Please contact your emergency contacts directly.'
          );
          return;
        }

        if (status !== 'sending') {
          setSosResult(
            `SOS is active. Email notification status: ${status}.`
          );
          return;
        }
      } catch (error) {
        setSosResult(
          'SOS is active. Unable to check email status right now. GPS tracking and evidence recording continue.'
        );
        return;
      }

      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    setSosResult(
      'SOS is active. Email notification is taking longer than expected. Please check the notification status again.'
    );
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
      // Always obtain a fresh GPS position before sending SOS.
      const permission = await Location.requestForegroundPermissionsAsync();

      if (permission.status !== 'granted') {
        throw new Error('Location permission is required to send SOS.');
      }

      const gpsResult = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      const current: CurrentLocation = {
        latitude: gpsResult.coords.latitude,
        longitude: gpsResult.coords.longitude,
        accuracy: gpsResult.coords.accuracy,
      };

      setLocation(current);

      // Reuse the existing SOS endpoint and its existing email alert flow.
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
        'SOS is active. Emergency contact email notifications are being processed. GPS tracking and evidence recording will continue.'
      );

      // Check the email result independently.
      void checkSosEmailStatus(result.incident_id, token);

      // Stop voice recognition before requesting the recording microphone.
      disableHelpVoiceTrigger();
      setVoiceEnabled(false);
      setVoiceStatus('Voice detection paused during SOS recording.');

      // Recording failure must never prevent SOS or GPS tracking.
      setEvidenceStatus('Requesting camera and microphone permission...');

      void startBrowserEvidenceRecording(result.incident_id, token)
        .then(() => {
          setEvidenceStatus('Audio and video recording is active.');
        })
        .catch((error: any) => {
          setEvidenceStatus(
            `Recording unavailable: ${error?.message || 'Camera or microphone permission was not granted.'} SOS and GPS tracking remain active.`
          );
        });

      // Continue live GPS tracking independently of recording.
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

  async function handleEnableVoiceHelp() {
    try {
      await enableHelpVoiceTrigger(
        () => {
          setVoiceEnabled(false);
          setVoiceStatus('Help detected. Starting SOS countdown.');
          void beginSosCountdown();
        },
        status => {
          setVoiceStatus(status);
        }
      );

      setVoiceEnabled(true);
    } catch (error: any) {
      setVoiceEnabled(false);
      setVoiceStatus(error.message || 'Could not enable voice activation.');
    }
  }

  function handleDisableVoiceHelp() {
    disableHelpVoiceTrigger();
    setVoiceEnabled(false);
    setVoiceStatus('Voice activation is off.');
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

      setEvidenceStatus('Stopping recording and saving evidence...');

      try {
        const evidenceResult = await stopBrowserEvidenceRecording();
        setEvidenceStatus(evidenceResult.message);
      } catch (evidenceError: any) {
        setEvidenceStatus(
          `Recording stop issue: ${evidenceError?.message || 'Evidence could not be saved.'}`
        );
      }

      activeIncidentIdRef.current = null;
      setActiveIncidentId(null);
      stopLiveTracking();

      setSosResult(
        'SOS incident stopped. Live location sharing has ended.'
      );
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
    if (activeIncidentIdRef.current !== null || sosBusy) {
      setMessage('Stop SOS before logging out.');
      return;
    }

    disableHelpVoiceTrigger();
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


  // Load local and server evidence for the signed-in user.
  async function loadEvidence() {
    setEvidenceLoading(true);
    setEvidenceError('');

    try {
      const incidents = await request('/api/incidents', 'GET', undefined, token);
      const incidentRows = Array.isArray(incidents) ? incidents : [];

      const uploadedGroups = await Promise.all(
        incidentRows.map(async (incident: any) => {
          try {
            const records = await request(
              `/api/incidents/${incident.id}/evidence`,
              'GET',
              undefined,
              token
            );
            return Array.isArray(records) ? records : [];
          } catch {
            return [];
          }
        })
      );

      setServerEvidence(uploadedGroups.flat());

      try {
        const localRecords = await listLocalEvidence();
        setLocalEvidence(localRecords);
      } catch (error: any) {
        setEvidenceError(
          `Local recordings could not be read: ${error?.message || 'Browser storage unavailable.'}`
        );
      }
    } catch (error: any) {
      setEvidenceError(
        error.message || 'Could not load evidence from the server.'
      );
    } finally {
      setEvidenceLoading(false);
    }
  }

  // Download a recording saved in this browser.
  async function downloadLocalEvidence(id: number) {
    try {
      const record = await getLocalEvidence(id);

      if (!record) {
        throw new Error('Local recording was not found.');
      }

      const url = URL.createObjectURL(record.blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = record.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error: any) {
      setEvidenceError(error.message || 'Could not download local evidence.');
    }
  }

  // Download an uploaded recording through the authenticated API.
  async function downloadServerEvidence(record: any) {
    try {
      const response = await fetch(
        `${API}/api/evidence/${record.id}/download`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Download failed (${response.status}).`);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = record.filename || `safeher-evidence-${record.id}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error: any) {
      setEvidenceError(error.message || 'Could not download uploaded evidence.');
    }
  }

  // Refresh evidence when the Evidence page is opened.
  useEffect(() => {
    if (loggedIn && activeSection === 'evidence') {
      void loadEvidence();
    }
  }, [activeSection, loggedIn, token]);
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


  const navigationItems = [
    { key: 'home' as const, label: 'Home', icon: 'H' },
    { key: 'sos' as const, label: 'Emergency SOS', icon: '!' },
    { key: 'location' as const, label: 'Live Location', icon: 'L' },
    { key: 'contacts' as const, label: 'Trusted Contacts', icon: 'C' },
    { key: 'profile' as const, label: 'My Profile', icon: 'P' },
    { key: 'evidence' as const, label: 'Evidence', icon: 'E' },
  ];

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.appShell}>
        {loggedIn ? (
          <View style={styles.sidebar}>
            <View style={styles.sidebarBrand}>
              <View style={styles.brandMark}>
                <Text style={styles.brandMarkText}>S</Text>
              </View>
              {Platform.OS === 'web' ? (
                <View>
                  <Text style={styles.sidebarLogo}>SafeHer</Text>
                  <Text style={styles.sidebarCaption}>SAFETY DASHBOARD</Text>
                </View>
              ) : null}
            </View>

            {Platform.OS === 'web' ? (
              <Text style={styles.sidebarSectionLabel}>WORKSPACE</Text>
            ) : null}
            <View style={styles.sidebarNav}>
              {navigationItems.map(item => (
                <Pressable
                  key={item.key}
                  onPress={() => setActiveSection(item.key)}
                  accessibilityRole="button"
                  accessibilityLabel={item.label}
                  style={[
                    styles.navItem,
                    activeSection === item.key && styles.navItemActive,
                  ]}
                >
                  <Text style={[
                    styles.navIcon,
                    activeSection === item.key && styles.navTextActive,
                  ]}>{item.icon}</Text>
                  {Platform.OS === 'web' ? (
                    <Text style={[
                      styles.navLabel,
                      activeSection === item.key && styles.navTextActive,
                    ]}>{item.label}</Text>
                  ) : null}
                </Pressable>
              ))}
            </View>

            {Platform.OS === 'web' ? (
              <View style={styles.sidebarBottom}>
                <View style={styles.sidebarStatusDot} />
                <View style={styles.sidebarStatusCopy}>
                  <Text style={styles.sidebarStatusTitle}>Your safety space</Text>
                  <Text style={styles.sidebarStatusText}>Private | Secure | Connected</Text>
                </View>
              </View>
            ) : null}
          </View>
        ) : null}

      <ScrollView
        style={loggedIn ? styles.mainScroll : undefined}
        contentContainerStyle={[styles.container, loggedIn && styles.dashboardContainer]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.topBar}>
          {loggedIn ? (
            <View>
              <Text style={styles.pageHeading}>
                {activeSection === 'home' ? 'Home' :
                  activeSection === 'sos' ? 'Emergency SOS' :
                  activeSection === 'location' ? 'Live Location' :
                  activeSection === 'contacts' ? 'Trusted Contacts' :
                  activeSection === 'evidence' ? 'Evidence' : 'My Profile'}
              </Text>
              <Text style={styles.pageSubheading}>
                {activeSection === 'home' ? 'Your personal safety overview.' :
                  activeSection === 'sos' ? 'Emergency assistance and alert controls.' :
                  activeSection === 'location' ? 'Manage your current location and live sharing.' :
                  activeSection === 'contacts' ? 'Manage the people in your trusted circle.' :
                  activeSection === 'evidence' ? 'Your saved and securely uploaded SOS recordings.' : 'Your account information and settings.'}
              </Text>
            </View>
          ) : (
            <View style={styles.brandRow}>
              <View style={styles.brandMark}>
                <Text style={styles.brandMarkText}>S</Text>
              </View>
              <View>
                <Text style={styles.logo}>SafeHer</Text>
                <Text style={styles.brandCaption}>PERSONAL SAFETY, REIMAGINED</Text>
              </View>
            </View>
          )}
          {loggedIn ? (
            <Pressable onPress={logout} style={styles.logoutButton}>
              <Text style={styles.logoutText}>Log out</Text>
            </Pressable>
          ) : (
            <View style={styles.secureBadge}>
              <Text style={styles.secureBadgeText}> SECURE</Text>
            </View>
          )}
        </View>

        {!loggedIn ? (
          <View style={styles.authWrap}>
            <View style={styles.authIntro}>
              <Text style={styles.eyebrow}>YOUR SAFETY COMPANION</Text>
              <Text style={styles.authTitle}>
                {isRegister ? 'Create your safe space.' : 'Your safety comes first.'}
              </Text>
              <Text style={styles.authDescription}>
                {isRegister
                  ? 'Set up your SafeHer account to connect with the people you trust.'
                  : 'Sign in to access your trusted contacts and emergency safety tools.'}
              </Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.heading}>
                {isRegister ? 'Create account' : 'Welcome back'}
              </Text>
              <Text style={styles.cardIntro}>
                {isRegister ? 'A few details to get you started.' : 'Enter your details to continue.'}
              </Text>

              {isRegister && (
                <>
                  <Text style={styles.label}>Full name</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Enter your name"
                    placeholderTextColor="#9A9EAA"
                    value={name}
                    onChangeText={setName}
                  />

                  <Text style={styles.label}>Phone number</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="+91XXXXXXXXXX"
                    placeholderTextColor="#9A9EAA"
                    value={phone}
                    onChangeText={setPhone}
                    keyboardType="phone-pad"
                  />
                </>
              )}

              <Text style={styles.label}>Email address</Text>
              <TextInput
                style={styles.input}
                placeholder="you@example.com"
                placeholderTextColor="#9A9EAA"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />

              <Text style={styles.label}>Password</Text>
              <TextInput
                style={styles.input}
                placeholder="Enter your password"
                placeholderTextColor="#9A9EAA"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
              />

              {message ? <Text style={styles.message}>{message}</Text> : null}

              <ActionButton
                title={
                  loading
                    ? 'Please wait...'
                    : isRegister
                      ? 'Create my account'
                      : 'Sign in securely'
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
                    ? 'Already have an account? Sign in'
                    : "New to SafeHer? Create an account"}
                </Text>
              </Pressable>
            </View>
            <Text style={styles.authFootnote}>Your trusted circle. Your control. Your safety.</Text>
          </View>
        ) : (
          <>
            <View style={styles.welcomeBlock}>
              <Text style={styles.eyebrow}>YOUR PERSONAL SAFETY SPACE</Text>
              <Text style={styles.welcomeTitle}>Hello, {user?.name?.split(' ')[0] || 'there'}.</Text>
              <Text style={styles.welcomeDescription}>
                Stay connected to the people and tools that help you feel safer.
              </Text>
            </View>

            {message ? (
              <View style={styles.notice}>
                <Text style={styles.noticeText}>{message}</Text>
              </View>
            ) : null}

            {(activeSection === 'home' || activeSection === 'sos') && (
              <>
            {/* SOS  primary action */}
            <View style={styles.sosCard}>
              <View style={styles.sosCardHeader}>
                <View>
                  <Text style={styles.sosEyebrow}>EMERGENCY ASSISTANCE</Text>
                  <Text style={styles.sosTitle}>Need help right now?</Text>
                </View>
                <View style={styles.sosStatusBadge}>
                  <View style={styles.sosStatusDot} />
                  <Text style={styles.sosStatusText}>
                    {activeIncidentId !== null ? 'SOS ACTIVE' : 'READY'}
                  </Text>
                </View>
              </View>

              <Text style={styles.sosDescription}>
                {activeIncidentId !== null
                  ? 'Your emergency session is active. Your foreground location updates are being shared.'
                  : 'Press the button to begin a 5-second safety countdown. You can cancel before your alert is sent.'}
              </Text>

              <View style={styles.sosButtonArea}>
                <View style={styles.sosOuterRing}>
                  <View style={styles.sosMiddleRing}>
                    <Pressable
                      onPress={
                        activeIncidentId !== null
                          ? stopSosIncident
                          : sosCountdown !== null
                            ? cancelSosCountdown
                            : beginSosCountdown
                      }
                      disabled={sosBusy && sosCountdown === null && activeIncidentId === null}
                      accessibilityRole="button"
                      accessibilityLabel={
                        activeIncidentId !== null
                          ? 'Stop emergency session'
                          : sosCountdown !== null
                            ? 'Cancel SOS countdown'
                            : 'Activate emergency SOS'
                      }
                      style={({ pressed }) => [
                        styles.sosCircle,
                        pressed && styles.sosCirclePressed,
                        sosBusy && sosCountdown === null && styles.disabledButton,
                      ]}
                    >
                      <Text style={styles.sosCircleTop}>
                        {activeIncidentId !== null
                          ? 'ACTIVE'
                          : sosCountdown !== null
                            ? 'CANCEL'
                            : sosBusy
                              ? 'PLEASE WAIT'
                              : 'TAP FOR'}
                      </Text>
                      <Text style={styles.sosCircleMain}>
                        {activeIncidentId !== null
                          ? 'STOP'
                          : sosCountdown !== null
                            ? String(sosCountdown)
                            : 'SOS'}
                      </Text>
                      <Text style={styles.sosCircleBottom}>
                        {activeIncidentId !== null
                          ? 'END SESSION'
                          : sosCountdown !== null
                            ? 'TO CANCEL'
                            : 'EMERGENCY'}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              </View>

              <Text style={styles.sosHelper}>
                {activeIncidentId !== null
                  ? 'Tap STOP only when you are safe and want to end sharing.'
                  : sosCountdown !== null
                    ? 'Your alert has not been sent yet. Tap the circle to cancel.'
                    : contacts.length === 0
                      ? 'Add at least one consenting emergency contact to enable SOS.'
                      : 'Your consenting contacts will receive an email with your initial location and a tracking link.'}
              </Text>

              <Pressable onPress={callEmergencyNumber} style={styles.call112Button}>
                <Text style={styles.call112Icon}>112</Text>
                <Text style={styles.call112Text}>Call emergency services</Text>
                <Text style={styles.call112Number}>112</Text>
              </Pressable>

              {sosResult ? (
                <View style={styles.resultPanel}>
                  <Text style={styles.resultText}>{sosResult}</Text>
                </View>
              ) : null}


              <View style={styles.card}>
                <Text style={styles.sectionTitle}>Voice Help Activation</Text>
                <Text style={styles.cardIntro}>
                  Enable voice recognition to start the existing 5-second SOS countdown when you say "Help".
                  Keep this browser tab open and visible.
                </Text>

                <ActionButton
                  title={voiceEnabled ? 'Disable Voice Help' : 'Enable Voice Help'}
                  onPress={voiceEnabled ? handleDisableVoiceHelp : handleEnableVoiceHelp}
                  disabled={activeIncidentId !== null || sosBusy}
                  secondary={voiceEnabled}
                />

                <Text style={styles.resultText}>
                  {voiceStatus}
                </Text>
                <Text style={styles.cardIntro}>
                  Microphone permission is required. Voice detection pauses during SOS recording and may not work when the browser tab is hidden or closed.
                </Text>
              </View>

              <View style={styles.card}>
                <Text style={styles.sectionTitle}>Audio & Video Evidence</Text>
                <Text style={styles.cardIntro}>
                  {evidenceStatus}
                </Text>
                <Text style={styles.cardIntro}>
                  Camera and microphone permission are requested after SOS is successfully created. If recording is unavailable, SOS and location sharing continue.
                </Text>
              </View>
              <Text style={styles.safetyDisclaimer}>
                SafeHer sends alerts to your saved contacts; it does not automatically dispatch police.
                GPS updates require permission, internet access and the app to remain open.
              </Text>
            </View>

              </>
            )}

            {activeSection === 'home' && (
              <>
            {/* Quick overview */}
            <View style={styles.sectionHeadingRow}>
              <Text style={styles.sectionTitle}>Your safety tools</Text>
              <Text style={styles.sectionMeta}>TOOLS & STATUS</Text>
            </View>

            <View style={styles.quickGrid}>
              <View style={styles.quickTile}>
                <View style={[styles.quickIcon, styles.quickIconRose]}>
                  <Text style={styles.quickIconText}>*</Text>
                </View>
                <Text style={styles.quickTitle}>Location</Text>
                <Text style={styles.quickValue}>
                  {location ? 'Location ready' : 'Not fetched'}
                </Text>
              </View>
              <View style={styles.quickTile}>
                <View style={[styles.quickIcon, styles.quickIconGreen]}>
                  <Text style={styles.quickIconText}>*</Text>
                </View>
                <Text style={styles.quickTitle}>Live tracking</Text>
                <Text style={styles.quickValue}>
                  {isTracking ? 'Currently active' : 'Currently off'}
                </Text>
              </View>
              <View style={styles.quickTile}>
                <View style={[styles.quickIcon, styles.quickIconGold]}>
                  <Text style={styles.quickIconText}>*</Text>
                </View>
                <Text style={styles.quickTitle}>Trusted people</Text>
                <Text style={styles.quickValue}>{contacts.length} saved contacts</Text>
              </View>
            </View>

              </>
            )}

            {activeSection === 'location' && (
              <>
            {/* Location and tracking */}
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <View style={styles.sectionIcon}>
                  <Text style={styles.sectionIconText}>S</Text>
                </View>
                <View style={styles.cardTitleCopy}>
                  <Text style={styles.heading}>Live location</Text>
                  <Text style={styles.cardIntro}>Your current GPS position and sharing status.</Text>
                </View>
              </View>

              <View style={[styles.statusBox, isTracking ? styles.trackingStatus : styles.stoppedStatus]}>
                <View style={[styles.statusDot, isTracking ? styles.activeDot : styles.inactiveDot]} />
                <Text style={styles.statusText}>
                  {isTracking ? 'LIVE TRACKING IS ON' : 'LIVE TRACKING IS OFF'}
                </Text>
              </View>

              {!isTracking ? (
                <ActionButton title="Start live tracking" onPress={startLiveTracking} />
              ) : (
                <ActionButton title="Stop live tracking" onPress={stopLiveTracking} secondary />
              )}

              <ActionButton
                title={locationLoading ? 'Getting location...' : 'Refresh my location'}
                onPress={getCurrentLocation}
                disabled={locationLoading}
                secondary
              />

              {locationLoading ? (
                <ActivityIndicator size="large" color="#D92F55" style={styles.loader} />
              ) : null}

              {locationError ? <Text style={styles.error}>{locationError}</Text> : null}

              {location ? (
                <View style={styles.locationDetails}>
                  <Text style={styles.locationTitle}>LOCATION DETAILS</Text>
                  <Text style={styles.detailText}>Latitude  |  {location.latitude.toFixed(6)}</Text>
                  <Text style={styles.detailText}>Longitude  |  {location.longitude.toFixed(6)}</Text>
                  <Text style={styles.detailText}>
                    Accuracy  |  {location.accuracy == null ? 'Not available' : `+/-${Math.round(location.accuracy)} m`}
                  </Text>
                  <ActionButton title="Open in Google Maps" onPress={openGoogleMaps} />
                </View>
              ) : (
                <Text style={styles.emptyText}>
                  Your coordinates will appear here after you refresh your GPS location.
                </Text>
              )}

              <Text style={styles.note}>
                Live tracking is foreground-only. It stops when you stop it or leave this screen.
              </Text>
            </View>

              </>
            )}

            {activeSection === 'contacts' && (
              <>
            {/* Emergency contacts */}
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <View style={styles.sectionIcon}>
                  <Text style={styles.sectionIconText}>S</Text>
                </View>
                <View style={styles.cardTitleCopy}>
                  <Text style={styles.heading}>Trusted contacts</Text>
                  <Text style={styles.cardIntro}>People who can receive your emergency alert.</Text>
                </View>
              </View>

              <View style={styles.contactCountBar}>
                <Text style={styles.contactCountLabel}>SAVED CONTACTS</Text>
                <Text style={styles.contactCountValue}>{contacts.length}</Text>
              </View>

              <Text style={styles.label}>Contact name</Text>
              <TextInput
                style={styles.input}
                placeholder="Enter contact name"
                placeholderTextColor="#9A9EAA"
                value={contactName}
                onChangeText={setContactName}
              />

              <Text style={styles.label}>Phone number</Text>
              <TextInput
                style={styles.input}
                placeholder="+91XXXXXXXXXX"
                placeholderTextColor="#9A9EAA"
                value={contactPhone}
                onChangeText={setContactPhone}
                keyboardType="phone-pad"
              />

              <Text style={styles.label}>Email address</Text>
              <TextInput
                style={styles.input}
                placeholder="contact@example.com"
                placeholderTextColor="#9A9EAA"
                value={contactEmail}
                onChangeText={setContactEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />

              <Pressable style={styles.consentRow} onPress={() => setConsent(!consent)}>
                <View style={[styles.checkbox, consent && styles.checkedBox]}>
                  {consent ? <Text style={styles.checkmark}>OK</Text> : null}
                </View>
                <Text style={styles.consentText}>
                  I confirm this person has agreed to be my emergency contact.
                </Text>
              </Pressable>

              <ActionButton
                title={loading ? 'Please wait...' : '+ Add trusted contact'}
                onPress={addContact}
                disabled={loading}
              />

              {message ? <Text style={styles.message}>{message}</Text> : null}

              <Text style={styles.subheading}>Your saved people</Text>
              {contacts.length === 0 ? (
                <View style={styles.emptyContacts}>
                  <Text style={styles.emptyContactsIcon}>C</Text>
                  <Text style={styles.emptyText}>No trusted contacts yet.</Text>
                  <Text style={styles.emptySubtext}>Add someone you trust using the form above.</Text>
                </View>
              ) : (
                contacts.map(contact => (
                  <View key={contact.id} style={styles.contactItem}>
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>
                        {contact.name.trim().charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View style={styles.contactInfo}>
                      <Text style={styles.contactName}>{contact.name}</Text>
                      <Text style={styles.contactPhone}>{contact.phone}</Text>
                      <Text style={styles.contactPhone}>{contact.email || 'No email saved'}</Text>
                    </View>
                    <Pressable onPress={() => deleteContact(contact.id)} style={styles.deleteButton}>
                      <Text style={styles.deleteText}>Remove</Text>
                    </Pressable>
                  </View>
                ))
              )}
            </View>

              </>
            )}

            {activeSection === 'evidence' && (
              <>
                <View style={styles.card}>
                  <View style={styles.cardTitleRow}>
                    <Text style={styles.sectionTitle}>Your Evidence</Text>
                    <ActionButton
                      title={evidenceLoading ? 'Loading...' : 'Refresh'}
                      onPress={loadEvidence}
                      disabled={evidenceLoading}
                      secondary
                    />
                  </View>

                  <Text style={styles.cardIntro}>
                    Recordings are linked to their SOS incident. Local files are stored in this browser; uploaded files are stored securely on your SafeHer backend.
                  </Text>

                  {evidenceError ? (
                    <View style={styles.resultPanel}>
                      <Text style={styles.resultText}>{evidenceError}</Text>
                    </View>
                  ) : null}

                  {evidenceLoading ? (
                    <ActivityIndicator size="large" color="#C83F68" />
                  ) : null}

                  <Text style={styles.sectionTitle}>Uploaded Evidence</Text>

                  {serverEvidence.length === 0 ? (
                    <Text style={styles.cardIntro}>
                      No uploaded recordings found.
                    </Text>
                  ) : (
                    serverEvidence.map((record: any) => (
                      <View key={`server-${record.id}`} style={styles.contactItem}>
                        <View style={styles.contactInfo}>
                          <Text style={styles.contactName}>{record.filename}</Text>
                          <Text style={styles.contactPhone}>
                            Incident #{record.incident_id} | {Math.round((record.file_size || 0) / 1024)} KB
                          </Text>
                          <Text style={styles.contactPhone}>
                            {record.created_at ? new Date(record.created_at).toLocaleString() : ''}
                          </Text>
                        </View>
                        <Pressable
                          onPress={() => downloadServerEvidence(record)}
                          style={styles.button}
                        >
                          <Text style={styles.buttonText}>Download</Text>
                        </Pressable>
                      </View>
                    ))
                  )}

                  <Text style={styles.sectionTitle}>Saved on This Browser</Text>

                  {localEvidence.length === 0 ? (
                    <Text style={styles.cardIntro}>
                      No local recordings found in this browser.
                    </Text>
                  ) : (
                    localEvidence.map((record: any) => (
                      <View key={`local-${record.id}`} style={styles.contactItem}>
                        <View style={styles.contactInfo}>
                          <Text style={styles.contactName}>{record.filename}</Text>
                          <Text style={styles.contactPhone}>
                            Incident #{record.incidentId}
                          </Text>
                          <Text style={styles.contactPhone}>
                            {record.createdAt ? new Date(record.createdAt).toLocaleString() : ''}
                          </Text>
                        </View>
                        <Pressable
                          onPress={() => downloadLocalEvidence(record.id)}
                          style={styles.button}
                        >
                          <Text style={styles.buttonText}>Download</Text>
                        </Pressable>
                      </View>
                    ))
                  )}
                </View>
              </>
            )}
            {activeSection === 'profile' && (
              <>
            <View style={styles.profileCard}>
              <View style={styles.profileAvatar}>
                <Text style={styles.profileAvatarText}>
                  {user?.name?.trim().charAt(0).toUpperCase() || 'S'}
                </Text>
              </View>
              <View style={styles.profileCopy}>
                <Text style={styles.profileName}>{user?.name}</Text>
                <Text style={styles.profileText}>{user?.email}</Text>
                <Text style={styles.profileText}>{user?.phone}</Text>
              </View>
              <Pressable onPress={logout} style={styles.profileLogout}>
                <Text style={styles.profileLogoutText}>Log out</Text>
              </Pressable>
            </View>
              </>
            )}
          </>
        )}

        <Text style={styles.footer}>SAFEHER  |  STAY AWARE. STAY SAFE.</Text>
      </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F6F7FB',
  },
  appShell: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#F6F7FB',
  },
  sidebar: {
    width: Platform.OS === 'web' ? 252 : 76,
    flexShrink: 0,
    backgroundColor: '#FFFFFF',
    borderRightWidth: 1,
    borderRightColor: '#E9ECF2',
    paddingTop: Platform.OS === 'web' ? 28 : 18,
    paddingHorizontal: Platform.OS === 'web' ? 18 : 8,
    paddingBottom: 20,
  },
  sidebarBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingHorizontal: Platform.OS === 'web' ? 4 : 0,
    justifyContent: Platform.OS === 'web' ? 'flex-start' : 'center',
    marginBottom: 38,
  },
  sidebarLogo: {
    color: '#20283B',
    fontSize: 21,
    fontWeight: '900',
    letterSpacing: -0.7,
  },
  sidebarCaption: {
    color: '#9AA1AF',
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 1,
    marginTop: 2,
  },
  sidebarSectionLabel: {
    color: '#A1A7B4',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.4,
    marginLeft: 10,
    marginBottom: 12,
  },
  sidebarNav: {
    gap: 7,
  },
  navItem: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingHorizontal: Platform.OS === 'web' ? 13 : 0,
    justifyContent: Platform.OS === 'web' ? 'flex-start' : 'center',
    borderRadius: 13,
    backgroundColor: 'transparent',
  },
  navItemActive: {
    backgroundColor: '#FFF0F3',
  },
  navIcon: {
    width: 24,
    textAlign: 'center',
    color: '#778094',
    fontSize: 20,
    fontWeight: '700',
  },
  navLabel: {
    color: '#687286',
    fontSize: 12,
    fontWeight: '700',
  },
  navTextActive: {
    color: '#D92F55',
  },
  sidebarBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 'auto',
    padding: 12,
    backgroundColor: '#F7F8FB',
    borderRadius: 13,
  },
  sidebarStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#36A36B',
  },
  sidebarStatusCopy: {
    flex: 1,
  },
  sidebarStatusTitle: {
    color: '#39445A',
    fontSize: 10,
    fontWeight: '800',
  },
  sidebarStatusText: {
    color: '#9299A7',
    fontSize: 8,
    marginTop: 3,
  },
  mainScroll: {
    flex: 1,
  },
  dashboardContainer: {
    maxWidth: 1120,
    paddingHorizontal: Platform.OS === 'web' ? 34 : 16,
    paddingTop: Platform.OS === 'web' ? 30 : 20,
  },
  pageHeading: {
    color: '#20283B',
    fontSize: 25,
    fontWeight: '900',
    letterSpacing: -0.7,
  },
  pageSubheading: {
    color: '#858D9D',
    fontSize: 12,
    marginTop: 4,
  },
  container: {
    flexGrow: 1,
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'web' ? 28 : 48,
    paddingBottom: 44,
  },
  topBar: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 30,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  brandMark: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: '#D92F55',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandMarkText: {
    color: '#FFFFFF',
    fontSize: 23,
    fontWeight: '900',
  },
  logo: {
    fontSize: 25,
    fontWeight: '900',
    color: '#20283B',
    letterSpacing: -0.8,
  },
  brandCaption: {
    color: '#969BA9',
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 1.15,
    marginTop: 2,
  },
  secureBadge: {
    backgroundColor: '#EAF6EF',
    borderRadius: 20,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  secureBadgeText: {
    color: '#278451',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  logoutButton: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E8EAF0',
  },
  logoutText: {
    color: '#60697B',
    fontSize: 12,
    fontWeight: '700',
  },
  authWrap: {
    width: '100%',
    maxWidth: 500,
    alignSelf: 'center',
  },
  authIntro: {
    marginBottom: 22,
  },
  eyebrow: {
    color: '#D92F55',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.7,
    marginBottom: 10,
  },
  authTitle: {
    color: '#20283B',
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '900',
    letterSpacing: -1.1,
  },
  authDescription: {
    color: '#737B8C',
    fontSize: 14,
    lineHeight: 22,
    marginTop: 10,
    maxWidth: 420,
  },
  card: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    padding: 22,
    borderRadius: 22,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: '#ECEEF3',
    elevation: 2,
    shadowColor: '#1B2540',
    shadowOpacity: 0.045,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
  },
  heading: {
    fontSize: 19,
    fontWeight: '800',
    color: '#20283B',
    letterSpacing: -0.35,
  },
  cardIntro: {
    color: '#8A91A0',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },
  label: {
    fontSize: 12,
    fontWeight: '800',
    color: '#535D70',
    marginBottom: 8,
    marginTop: 17,
  },
  input: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#E5E8EF',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 14,
    color: '#252D40',
    backgroundColor: '#FAFBFD',
  },
  button: {
    backgroundColor: '#D92F55',
    paddingVertical: 15,
    paddingHorizontal: 18,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 17,
    minHeight: 50,
  },
  secondaryButton: {
    backgroundColor: '#F3F4F8',
    borderWidth: 1,
    borderColor: '#E5E8EF',
  },
  disabledButton: {
    opacity: 0.55,
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 14,
    letterSpacing: 0.1,
  },
  secondaryButtonText: {
    color: '#3C465B',
  },
  switchButton: {
    marginTop: 20,
    alignItems: 'center',
  },
  switchText: {
    color: '#D92F55',
    fontWeight: '800',
    fontSize: 13,
  },
  message: {
    color: '#C43B55',
    backgroundColor: '#FFF0F2',
    borderRadius: 10,
    padding: 11,
    marginTop: 13,
    fontSize: 12,
    lineHeight: 18,
  },
  error: {
    color: '#B42338',
    marginTop: 12,
    lineHeight: 20,
    fontSize: 13,
  },
  authFootnote: {
    textAlign: 'center',
    color: '#A1A6B2',
    fontSize: 11,
    marginTop: 20,
  },
  welcomeBlock: {
    marginBottom: 20,
  },
  welcomeTitle: {
    color: '#20283B',
    fontSize: 31,
    fontWeight: '900',
    letterSpacing: -1,
  },
  welcomeDescription: {
    color: '#7B8393',
    fontSize: 13,
    lineHeight: 20,
    marginTop: 6,
    maxWidth: 460,
  },
  notice: {
    width: '100%',
    backgroundColor: '#FFF5E8',
    borderColor: '#F6D9A8',
    borderWidth: 1,
    borderRadius: 13,
    padding: 13,
    marginBottom: 16,
  },
  noticeText: {
    color: '#8D5A13',
    fontSize: 12,
    lineHeight: 18,
  },
  sosCard: {
    width: '100%',
    backgroundColor: '#20283B',
    borderRadius: 26,
    padding: 22,
    marginBottom: 25,
    overflow: 'hidden',
  },
  sosCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  sosEyebrow: {
    color: '#F6A7B5',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  sosTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
    marginTop: 5,
    letterSpacing: -0.4,
  },
  sosStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#354158',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  sosStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#6FE0A0',
    marginRight: 6,
  },
  sosStatusText: {
    color: '#E8EDF5',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.7,
  },
  sosDescription: {
    color: '#C2CAD8',
    fontSize: 12,
    lineHeight: 19,
    marginTop: 12,
    maxWidth: 460,
  },
  sosButtonArea: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 23,
  },
  sosOuterRing: {
    width: 224,
    height: 224,
    borderRadius: 112,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sosMiddleRing: {
    width: 202,
    height: 202,
    borderRadius: 101,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sosCircle: {
    width: 174,
    height: 174,
    borderRadius: 87,
    backgroundColor: '#E52F4F',
    borderWidth: 7,
    borderColor: '#F57B8E',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
    shadowColor: '#F13F5E',
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
  },
  sosCirclePressed: {
    transform: [{ scale: 0.97 }],
    backgroundColor: '#C91F40',
  },
  sosCircleTop: {
    color: '#FFE7EA',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 2,
  },
  sosCircleMain: {
    color: '#FFFFFF',
    fontSize: 43,
    lineHeight: 50,
    fontWeight: '900',
    letterSpacing: -1,
  },
  sosCircleBottom: {
    color: '#FFE7EA',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  sosHelper: {
    color: '#C2CAD8',
    fontSize: 11,
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: 17,
  },
  call112Button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 13,
    paddingVertical: 13,
    paddingHorizontal: 14,
  },
  call112Icon: {
    color: '#D92F55',
    fontSize: 17,
    marginRight: 8,
  },
  call112Text: {
    color: '#30394C',
    fontSize: 12,
    fontWeight: '800',
    flex: 1,
  },
  call112Number: {
    color: '#D92F55',
    fontSize: 17,
    fontWeight: '900',
  },
  resultPanel: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 11,
    padding: 12,
    marginTop: 13,
  },
  resultText: {
    color: '#FFFFFF',
    fontSize: 11,
    lineHeight: 18,
  },
  safetyDisclaimer: {
    color: '#AEB8C9',
    fontSize: 10,
    lineHeight: 16,
    marginTop: 14,
    textAlign: 'center',
  },
  sectionHeadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitle: {
    color: '#20283B',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  sectionMeta: {
    color: '#A0A6B3',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
  },
  quickGrid: {
    width: '100%',
    flexDirection: 'row',
    gap: 10,
    marginBottom: 18,
  },
  quickTile: {
    flex: 1,
    minWidth: 0,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#ECEEF3',
    borderRadius: 17,
    padding: 12,
  },
  quickIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  quickIconRose: { backgroundColor: '#FFF0F2' },
  quickIconGreen: { backgroundColor: '#EAF7F0' },
  quickIconGold: { backgroundColor: '#FFF6E7' },
  quickIconText: {
    color: '#3B465B',
    fontSize: 20,
    fontWeight: '800',
  },
  quickTitle: {
    color: '#30394C',
    fontSize: 11,
    fontWeight: '800',
  },
  quickValue: {
    color: '#9299A8',
    fontSize: 9,
    lineHeight: 14,
    marginTop: 4,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 15,
  },
  sectionIcon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: '#FFF0F2',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  sectionIconText: {
    color: '#D92F55',
    fontSize: 22,
    fontWeight: '800',
  },
  cardTitleCopy: {
    flex: 1,
  },
  statusBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 11,
    marginTop: 2,
    marginBottom: 3,
  },
  trackingStatus: { backgroundColor: '#EAF7F0' },
  stoppedStatus: { backgroundColor: '#F3F4F7' },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 9,
  },
  activeDot: { backgroundColor: '#26945A' },
  inactiveDot: { backgroundColor: '#9AA1AE' },
  statusText: {
    fontSize: 10,
    fontWeight: '900',
    color: '#536075',
    letterSpacing: 0.6,
  },
  loader: { marginTop: 15 },
  locationDetails: {
    marginTop: 16,
    padding: 15,
    backgroundColor: '#F5F8FC',
    borderRadius: 13,
  },
  locationTitle: {
    color: '#278451',
    fontWeight: '900',
    fontSize: 10,
    letterSpacing: 1,
    marginBottom: 12,
  },
  detailText: {
    color: '#596477',
    fontSize: 12,
    marginBottom: 9,
  },
  note: {
    color: '#9AA1AE',
    fontSize: 10,
    lineHeight: 16,
    marginTop: 14,
  },
  emptyText: {
    color: '#7F8796',
    fontSize: 12,
    marginTop: 12,
    lineHeight: 18,
  },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 17,
  },
  checkbox: {
    width: 21,
    height: 21,
    borderWidth: 1,
    borderColor: '#C7CDD8',
    borderRadius: 6,
    marginRight: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkedBox: {
    backgroundColor: '#D92F55',
    borderColor: '#D92F55',
  },
  checkmark: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 12,
  },
  consentText: {
    flex: 1,
    color: '#687184',
    fontSize: 11,
    lineHeight: 17,
  },
  contactCountBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F7F8FB',
    padding: 12,
    borderRadius: 11,
    marginTop: 4,
  },
  contactCountLabel: {
    color: '#858D9C',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
  },
  contactCountValue: {
    color: '#D92F55',
    fontSize: 16,
    fontWeight: '900',
  },
  subheading: {
    fontSize: 14,
    fontWeight: '900',
    marginTop: 25,
    marginBottom: 9,
    color: '#30394C',
  },
  emptyContacts: {
    alignItems: 'center',
    backgroundColor: '#F8F9FC',
    borderRadius: 13,
    padding: 18,
    marginTop: 6,
  },
  emptyContactsIcon: {
    color: '#D92F55',
    fontSize: 25,
  },
  emptySubtext: {
    color: '#A0A6B3',
    fontSize: 10,
    marginTop: 4,
    textAlign: 'center',
  },
  contactItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F1F5',
    gap: 10,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 13,
    backgroundColor: '#FFF0F2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#D92F55',
    fontSize: 15,
    fontWeight: '900',
  },
  contactInfo: { flex: 1 },
  contactName: {
    fontSize: 13,
    fontWeight: '900',
    color: '#30394C',
  },
  contactPhone: {
    fontSize: 10,
    color: '#8C94A2',
    marginTop: 3,
  },
  deleteButton: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#FFF0F2',
    borderRadius: 9,
  },
  deleteText: {
    color: '#C43B55',
    fontWeight: '800',
    fontSize: 10,
  },
  profileCard: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#ECEEF3',
    borderRadius: 17,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  profileAvatar: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: '#20283B',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 11,
  },
  profileAvatarText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '900',
  },
  profileCopy: { flex: 1 },
  profileName: {
    color: '#30394C',
    fontSize: 12,
    fontWeight: '900',
    marginBottom: 3,
  },
  profileText: {
    fontSize: 10,
    color: '#8C94A2',
    marginTop: 2,
  },
  profileLogout: {
    paddingHorizontal: 11,
    paddingVertical: 8,
    backgroundColor: '#F3F4F8',
    borderRadius: 9,
  },
  profileLogoutText: {
    color: '#60697B',
    fontSize: 10,
    fontWeight: '800',
  },
  footer: {
    color: '#A8ADBA',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.1,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 10,
  },
});

