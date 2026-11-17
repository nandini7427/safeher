
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams } from "expo-router";

const API_URL = "http://10.24.233.119:8001";

type TrackingData = {
  name?: string;
  status?: string;
  latitude?: number | null;
  longitude?: number | null;
  accuracy?: number | null;
  updated_at?: string | null;
};

export default function TrackLocationScreen() {
  const params = useLocalSearchParams<{ token: string }>();
  const token = Array.isArray(params.token) ? params.token[0] : params.token;

  const [data, setData] = useState<TrackingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState("");

  const fetchLocation = useCallback(async () => {
    if (!token) {
      setError("Tracking link is missing its token.");
      setLoading(false);
      return;
    }

    try {
      const response = await fetch(
        `${API_URL}/api/track/${encodeURIComponent(token)}`
      );

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error("Tracking link not found or no longer valid.");
        }
        throw new Error(`Unable to load location. Error ${response.status}.`);
      }

      const result = await response.json();
      setData(result);
      setError("");
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to load location."
      );
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchLocation();

    const interval = setInterval(fetchLocation, 5000);

    return () => clearInterval(interval);
  }, [fetchLocation]);

  const openMap = () => {
    if (data?.latitude == null || data?.longitude == null) return;

    const url = `https://www.google.com/maps/search/?api=1&query=${data.latitude},${data.longitude}`;
    Linking.openURL(url);
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.heading}>SafeHer Live Tracking</Text>
      <Text style={styles.subtitle}>
        Emergency location updates
      </Text>

      {loading && !data ? (
        <ActivityIndicator size="large" color="#e53955" />
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {data ? (
        <View style={styles.card}>
          <Text style={styles.label}>Person</Text>
          <Text style={styles.value}>{data.name || "SafeHer user"}</Text>

          <Text style={styles.label}>Incident status</Text>
          <Text style={styles.value}>{data.status || "Unknown"}</Text>

          <Text style={styles.label}>Latitude</Text>
          <Text style={styles.value}>
            {data.latitude ?? "Not available"}
          </Text>

          <Text style={styles.label}>Longitude</Text>
          <Text style={styles.value}>
            {data.longitude ?? "Not available"}
          </Text>

          <Text style={styles.label}>GPS accuracy</Text>
          <Text style={styles.value}>
            {data.accuracy != null ? `${data.accuracy} metres` : "Not available"}
          </Text>

          <Text style={styles.label}>Last location update</Text>
          <Text style={styles.value}>
            {data.updated_at || "Not available"}
          </Text>

          <Pressable
            style={styles.button}
            onPress={openMap}
            disabled={data.latitude == null || data.longitude == null}
          >
            <Text style={styles.buttonText}>Open Location in Google Maps</Text>
          </Pressable>
        </View>
      ) : null}

      <Text style={styles.refresh}>
        Automatically refreshes every 5 seconds.
      </Text>
      {lastUpdated ? (
        <Text style={styles.refresh}>Page checked at {lastUpdated}</Text>
      ) : null}

      <Pressable style={styles.secondaryButton} onPress={fetchLocation}>
        <Text style={styles.secondaryText}>Refresh Now</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 24,
    backgroundColor: "#fff5f6",
    alignItems: "center",
  },
  heading: {
    fontSize: 27,
    fontWeight: "bold",
    color: "#c62845",
    marginTop: 35,
  },
  subtitle: {
    fontSize: 15,
    color: "#666",
    marginTop: 8,
    marginBottom: 25,
  },
  card: {
    width: "100%",
    maxWidth: 520,
    backgroundColor: "white",
    borderRadius: 16,
    padding: 22,
    elevation: 3,
  },
  label: {
    fontSize: 13,
    color: "#777",
    marginTop: 15,
  },
  value: {
    fontSize: 17,
    color: "#222",
    fontWeight: "600",
    marginTop: 4,
  },
  error: {
    color: "#c62828",
    backgroundColor: "#ffebee",
    padding: 14,
    borderRadius: 10,
    marginVertical: 15,
  },
  button: {
    backgroundColor: "#d93654",
    padding: 15,
    borderRadius: 10,
    marginTop: 25,
    alignItems: "center",
  },
  buttonText: {
    color: "white",
    fontWeight: "bold",
  },
  refresh: {
    color: "#666",
    fontSize: 13,
    marginTop: 18,
    textAlign: "center",
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: "#d93654",
    padding: 12,
    borderRadius: 10,
    marginTop: 18,
  },
  secondaryText: {
    color: "#d93654",
    fontWeight: "600",
  },
});
