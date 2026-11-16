
import React, { useEffect, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup
} from "react-leaflet";
import L from "leaflet";

const API = "http://127.0.0.1:8000";

// Leaflet marker configuration
const markerIcon = new L.Icon({
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41]
});

// API request helper
async function apiRequest(path, token = null, options = {}) {
  let response;

  try {
    response = await fetch(`${API}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token
          ? { Authorization: `Bearer ${token}` }
          : {}),
        ...(options.headers || {})
      }
    });
  } catch (error) {
    throw new Error(
      "Cannot connect to SafeHer backend. Make sure FastAPI is running at http://127.0.0.1:8000"
    );
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      typeof data.detail === "string"
        ? data.detail
        : JSON.stringify(data.detail || data)
    );
  }

  return data;
}

// Authentication page
function Auth({ onAuth }) {
  const [mode, setMode] = useState("register");

  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    password: ""
  });

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function handleChange(e) {
    setForm({
      ...form,
      [e.target.name]: e.target.value
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();

    setError("");
    setLoading(true);

    try {
      const endpoint =
        mode === "register"
          ? "/api/auth/register"
          : "/api/auth/login";

      const payload =
        mode === "register"
          ? form
          : {
              email: form.email,
              password: form.password
            };

      const result = await apiRequest(endpoint, null, {
        method: "POST",
        body: JSON.stringify(payload)
      });

      onAuth(result);

    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth">
      <div className="brand">
        Safe<span>Her</span>
      </div>

      <p className="muted">
        Real-time Women Safety and Emergency Response
      </p>

      <form className="panel" onSubmit={handleSubmit}>
        <h2>
          {mode === "register"
            ? "Create your account"
            : "Welcome back"}
        </h2>

        {mode === "register" && (
          <>
            <label>
              Full Name
              <input
                name="name"
                value={form.name}
                onChange={handleChange}
                placeholder="Enter your full name"
                required
                minLength={2}
              />
            </label>

            <label>
              Phone Number
              <input
                name="phone"
                value={form.phone}
                onChange={handleChange}
                placeholder="+91XXXXXXXXXX"
                pattern="^\+[1-9]\d{7,14}$"
                required
              />
            </label>
          </>
        )}

        <label>
          Email Address
          <input
            name="email"
            type="email"
            value={form.email}
            onChange={handleChange}
            placeholder="Enter your email"
            required
          />
        </label>

        <label>
          Password
          <input
            name="password"
            type="password"
            value={form.password}
            onChange={handleChange}
            placeholder="Minimum 10 characters"
            minLength={10}
            required
          />
        </label>

        {error && (
          <div className="notice error">
            {error}
          </div>
        )}

        <button
          className="primary"
          type="submit"
          disabled={loading}
        >
          {loading
            ? "Please wait..."
            : mode === "register"
            ? "Create Account"
            : "Login"}
        </button>

        <button
          type="button"
          className="link"
          onClick={() => {
            setMode(
              mode === "register" ? "login" : "register"
            );
            setError("");
          }}
        >
          {mode === "register"
            ? "Already registered? Login"
            : "New user? Create account"}
        </button>
      </form>

      <p className="tiny">
        Your information is stored in the SafeHer database.
      </p>
    </main>
  );
}

// Live tracking page for emergency contacts
function Track({ token }) {
  const [location, setLocation] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadLocation() {
      try {
        const result = await apiRequest(
          `/api/track/${token}`
        );

        if (active) {
          setLocation(result);
          setError("");
        }
      } catch (err) {
        if (active) setError(err.message);
      }
    }

    loadLocation();

    const timer = setInterval(loadLocation, 5000);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [token]);

  return (
    <main className="wrap">
      <div className="brand">
        Safe<span>Her</span>
      </div>

      <h1>Live Location Sharing</h1>

      {error && <p className="error">{error}</p>}

      {location && (
        <>
          <p>
            Location shared by <b>{location.name}</b>
          </p>

          <MapContainer
            center={[
              location.latitude,
              location.longitude
            ]}
            zoom={16}
            style={{
              height: "400px",
              borderRadius: "16px"
            }}
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution="&copy; OpenStreetMap contributors"
            />

            <Marker
              position={[
                location.latitude,
                location.longitude
              ]}
              icon={markerIcon}
            >
              <Popup>
                Latest shared location
              </Popup>
            </Marker>
          </MapContainer>

          <p className="tiny">
            Last update:{" "}
            {new Date(location.updated_at).toLocaleString()}
          </p>

          <a
            href={`https://www.google.com/maps?q=${location.latitude},${location.longitude}`}
            target="_blank"
            rel="noreferrer"
          >
            Open in Google Maps
          </a>
        </>
      )}
    </main>
  );
}

// Main dashboard
function Dashboard({ auth, onLogout }) {
  const token = auth.access_token;

  const [contacts, setContacts] = useState([]);

  const [form, setForm] = useState({
    name: "",
    phone: "",
    consent_confirmed: false
  });

  const [position, setPosition] = useState(null);
  const [incident, setIncident] = useState(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadContacts() {
    try {
      const result = await apiRequest(
        "/api/contacts",
        token
      );

      setContacts(result);
    } catch (err) {
      setMessage(err.message);
    }
  }

  useEffect(() => {
    loadContacts();
  }, []);

  function getLocation() {
    if (!navigator.geolocation) {
      setMessage("Your browser does not support GPS.");
      return;
    }

    setMessage("Requesting actual device location...");

    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPosition({
          latitude: p.coords.latitude,
          longitude: p.coords.longitude,
          accuracy_m: p.coords.accuracy
        });

        setMessage("Actual GPS location obtained.");
      },
      (err) => {
        setMessage("GPS error: " + err.message);
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0
      }
    );
  }

  async function addContact(e) {
    e.preventDefault();

    try {
      await apiRequest("/api/contacts", token, {
        method: "POST",
        body: JSON.stringify(form)
      });

      setForm({
        name: "",
        phone: "",
        consent_confirmed: false
      });

      await loadContacts();

      setMessage("Emergency contact saved successfully.");

    } catch (err) {
      setMessage(err.message);
    }
  }

  async function removeContact(id) {
    try {
      await apiRequest(
        `/api/contacts/${id}`,
        token,
        { method: "DELETE" }
      );

      await loadContacts();

      setMessage("Contact removed.");

    } catch (err) {
      setMessage(err.message);
    }
  }

  async function activateSOS() {
    if (contacts.length === 0) {
      setMessage("Add an emergency contact first.");
      return;
    }

    setBusy(true);
    setMessage("");

    try {
      let gps = position;

      if (!gps) {
        if (!navigator.geolocation) {
          throw new Error("GPS is unavailable.");
        }

        gps = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(
            (p) => resolve({
              latitude: p.coords.latitude,
              longitude: p.coords.longitude,
              accuracy_m: p.coords.accuracy
            }),
            reject,
            {
              enableHighAccuracy: true,
              timeout: 15000,
              maximumAge: 0
            }
          );
        });

        setPosition(gps);
      }

      const result = await apiRequest(
        "/api/sos",
        token,
        {
          method: "POST",
          body: JSON.stringify(gps)
        }
      );

      setIncident(result);

      setMessage(
        `Incident ${result.incident_id} created. SMS status: ${result.sms_status}.`
      );

    } catch (err) {
      setMessage(
        "SOS failed: " + err.message
      );
    } finally {
      setBusy(false);
    }
  }

  async function stopSOS() {
    if (!incident) return;

    try {
      await apiRequest(
        `/api/incidents/${incident.incident_id}/stop`,
        token,
        { method: "POST" }
      );

      setIncident(null);
      setMessage("Emergency sharing session ended.");

    } catch (err) {
      setMessage(err.message);
    }
  }

  // Send actual location updates while SOS is active.
  useEffect(() => {
    if (!incident) return;

    const timer = setInterval(() => {
      navigator.geolocation.getCurrentPosition(
        async (p) => {
          const gps = {
            latitude: p.coords.latitude,
            longitude: p.coords.longitude,
            accuracy_m: p.coords.accuracy
          };

          setPosition(gps);

          try {
            await apiRequest(
              `/api/incidents/${incident.incident_id}/location`,
              token,
              {
                method: "POST",
                body: JSON.stringify(gps)
              }
            );
          } catch (err) {
            setMessage(err.message);
          }
        },
        (err) => {
          setMessage("GPS update error: " + err.message);
        },
        {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 12000
        }
      );
    }, 10000);

    return () => clearInterval(timer);
  }, [incident?.incident_id]);

  return (
    <main className="wrap">

      <header>
        <div>
          <div className="brand">
            Safe<span>Her</span>
          </div>

          <p className="muted">
            Welcome, {auth.user.name}
          </p>
        </div>

        <button
          className="secondary"
          onClick={onLogout}
        >
          Logout
        </button>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">
            WOMEN SAFETY SYSTEM
          </p>

          <h1>Your Safety Matters.</h1>

          <p className="muted">
            Your trusted emergency response dashboard.
          </p>
        </div>

        <button
          className="sos"
          onClick={activateSOS}
          disabled={busy || !!incident}
        >
          {busy
            ? "SENDING..."
            : incident
            ? "SOS ACTIVE"
            : "SOS"}
        </button>
      </section>

      {message && (
        <div className="notice">
          {message}
        </div>
      )}

      <div className="grid">

        <section className="panel">
          <h2>My Current Location</h2>

          <button
            className="primary"
            onClick={getLocation}
          >
            Get Actual GPS Location
          </button>

          {position && (
            <>
              <p className="tiny">
                Latitude: {position.latitude}
                <br />
                Longitude: {position.longitude}
                <br />
                Accuracy: ±{Math.round(position.accuracy_m)} m
              </p>

              <MapContainer
                center={[
                  position.latitude,
                  position.longitude
                ]}
                zoom={15}
                style={{
                  height: "250px",
                  marginTop: "12px",
                  borderRadius: "12px"
                }}
              >
                <TileLayer
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  attribution="&copy; OpenStreetMap contributors"
                />

                <Marker
                  position={[
                    position.latitude,
                    position.longitude
                  ]}
                  icon={markerIcon}
                >
                  <Popup>
                    Your current location
                  </Popup>
                </Marker>
              </MapContainer>
            </>
          )}
        </section>

        <section className="panel">
          <h2>Emergency Contacts</h2>

          <form onSubmit={addContact}>
            <label>
              Contact Name

              <input
                value={form.name}
                onChange={(e) =>
                  setForm({
                    ...form,
                    name: e.target.value
                  })
                }
                required
              />
            </label>

            <label>
              Phone Number

              <input
                value={form.phone}
                onChange={(e) =>
                  setForm({
                    ...form,
                    phone: e.target.value
                  })
                }
                placeholder="+91XXXXXXXXXX"
                pattern="^\+[1-9]\d{7,14}$"
                required
              />
            </label>

            <label className="check">
              <input
                type="checkbox"
                checked={form.consent_confirmed}
                onChange={(e) =>
                  setForm({
                    ...form,
                    consent_confirmed: e.target.checked
                  })
                }
              />

              Contact has agreed to receive alerts.
            </label>

            <button className="primary">
              Add Emergency Contact
            </button>
          </form>

          <ul className="contacts">
            {contacts.map((contact) => (
              <li key={contact.id}>
                <span>
                  <b>{contact.name}</b>
                  <small>{contact.phone}</small>
                </span>

                <button
                  className="link danger"
                  onClick={() =>
                    removeContact(contact.id)
                  }
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </section>

      </div>

      {incident && (
        <section className="panel active">
          <h2>Emergency Session Active</h2>

          <p>
            SMS status: <b>{incident.sms_status}</b>
          </p>

          <p className="tiny">
            Tracking link:
            <br />
            <a
              href={incident.tracking_url}
              target="_blank"
              rel="noreferrer"
            >
              {incident.tracking_url}
            </a>
          </p>

          <p className="tiny">
            Recipient results:{" "}
            {JSON.stringify(incident.recipient_results)}
          </p>

          <button
            className="secondary"
            onClick={stopSOS}
          >
            End Emergency Session
          </button>
        </section>
      )}

      <section className="panel emergency">
        <h2>Need Immediate Help?</h2>

        <p>
          India's emergency assistance number is 112.
          This website does not automatically dispatch police.
        </p>

        <a className="call" href="tel:112">
          Call 112
        </a>
      </section>

      <p className="tiny muted">
        Use with consenting emergency contacts. Location
        sharing depends on device permissions and connectivity.
        Test the application before relying on it in an emergency.
      </p>

    </main>
  );
}

// Main application
export default function App() {
  const [auth, setAuth] = useState(() => {
    try {
      return JSON.parse(
        localStorage.getItem("safeher_auth")
      );
    } catch {
      return null;
    }
  });

  const path = window.location.pathname;

  if (path.startsWith("/track/")) {
    return (
      <Track token={path.split("/")[2]} />
    );
  }

  function handleAuth(data) {
    localStorage.setItem(
      "safeher_auth",
      JSON.stringify(data)
    );

    setAuth(data);
  }

  function logout() {
    localStorage.removeItem("safeher_auth");
    setAuth(null);
  }

  return auth ? (
    <Dashboard
      auth={auth}
      onLogout={logout}
    />
  ) : (
    <Auth onAuth={handleAuth} />
  );
}
