import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import Svg, { Line, Polyline, Circle, Path } from "react-native-svg";
import { LinearGradient } from "expo-linear-gradient";
import { colors, fonts, radii, spacing } from "../config/theme";
import RadarView from "../components/RadarView";
import PersonCard from "../components/PersonCard";
import { getCurrentLocation, startLocationUpdates, type LocationData } from "../services/location";
import { updateLocation } from "../services/api";
import { fetchNearbyPeople } from "../services/matching";
import { respondToMatch } from "../services/api";
import { getDeviceId } from "../services/deviceId";
import { setDeviceHeader } from "../config/supabase";
import { RANGE_OPTIONS, type NearbyPerson } from "../types";

// Mock data for development
const MOCK_PEOPLE: NearbyPerson[] = [
  {
    id: "1",
    device_id: "d1",
    display_name: "Marcus Chen",
    line1: "Protocol engineer",
    line2: "Obsessed with agent communication",
    line3: "Building p2p networks",
    emoji: "🛠",
    distance_m: 120,
    angle: Math.PI * 0.3,
    match: {
      id: "m1",
      device_id_a: "me",
      device_id_b: "d1",
      reason: "你们都在折腾 agent 通信，他从硬件来你从设计来——聊聊肯定有意思",
      score: 0.9,
      status: "pending",
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      created_at: new Date().toISOString(),
    },
  },
  {
    id: "2",
    device_id: "d2",
    display_name: "Sora Kim",
    line1: "Interaction designer",
    line2: "AI-native interfaces",
    line3: null,
    emoji: "🎨",
    distance_m: 340,
    angle: Math.PI * 1.2,
  },
  {
    id: "3",
    device_id: "d3",
    display_name: "Luna Park",
    line1: "Sound artist",
    line2: "Generative music × spatial",
    line3: "Live performances",
    emoji: "🎵",
    distance_m: 200,
    angle: Math.PI * 0.8,
  },
  {
    id: "4",
    device_id: "d4",
    display_name: "Alex Rivera",
    line1: "Personal AI memory startup",
    line2: "Digital context ownership",
    line3: null,
    emoji: "🧬",
    distance_m: 480,
    angle: Math.PI * 1.6,
  },
  {
    id: "5",
    device_id: "d5",
    display_name: "Dev Patel",
    line1: "Edge computing systems",
    line2: "IoT sensor networks",
    line3: "10ms inference latency",
    emoji: "⚡",
    distance_m: 700,
    angle: Math.PI * 0.1,
  },
];

function BackArrowIcon() {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
      <Line
        x1={19} y1={12} x2={5} y2={12}
        stroke={colors.engrave}
        strokeWidth={2.5}
        strokeLinecap="round"
      />
      <Polyline
        points="12 19 5 12 12 5"
        stroke={colors.engrave}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

function GearIcon() {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
      <Circle
        cx={12} cy={12} r={3}
        stroke={colors.engrave}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
        stroke={colors.engrave}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function SmallButton({ children }: { children: React.ReactNode }) {
  return (
    <TouchableOpacity style={styles.smallButton} activeOpacity={0.7}>
      <LinearGradient
        colors={[colors.aluLight, colors.aluDark]}
        start={{ x: 0.15, y: 0.15 }}
        end={{ x: 0.85, y: 0.85 }}
        style={styles.smallButtonGradient}
      >
        {children}
      </LinearGradient>
    </TouchableOpacity>
  );
}

export default function RadarScreen() {
  const [selectedRange, setSelectedRange] = useState(1); // 500m default
  const [people, setPeople] = useState<NearbyPerson[]>(MOCK_PEOPLE);
  const [selectedPerson, setSelectedPerson] = useState<NearbyPerson | null>(
    null
  );
  const [location, setLocation] = useState<LocationData | null>(null);
  const [deviceId, setDeviceId] = useState<string>("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getDeviceId().then((id) => {
      setDeviceId(id);
      setDeviceHeader(id);
    });
  }, []);

  // Location updates
  useEffect(() => {
    if (!deviceId) return;

    const stopUpdates = startLocationUpdates(async (loc) => {
      setLocation(loc);
      try {
        await updateLocation(deviceId, loc.latitude, loc.longitude, loc.geohash);
      } catch {
        // Supabase not configured yet — ignore
      }
    });

    return stopUpdates;
  }, [deviceId]);

  // Fetch nearby when location or range changes
  const refreshNearby = useCallback(async () => {
    if (!location || !deviceId) return;
    setLoading(true);
    try {
      const result = await fetchNearbyPeople(
        location.latitude,
        location.longitude,
        RANGE_OPTIONS[selectedRange].meters,
        deviceId
      );
      if (result.length > 0) {
        setPeople(result);
      }
    } catch {
      // Keep mock data on error
    } finally {
      setLoading(false);
    }
  }, [location, deviceId, selectedRange]);

  useEffect(() => {
    refreshNearby();
  }, [refreshNearby]);

  const handleSkip = async () => {
    if (selectedPerson?.match) {
      try {
        await respondToMatch(selectedPerson.match.id, "skipped");
      } catch {
        // ignore
      }
    }
    setSelectedPerson(null);
  };

  const handleConnect = async () => {
    if (selectedPerson?.match) {
      try {
        await respondToMatch(selectedPerson.match.id, "accepted");
      } catch {
        // ignore
      }
    }
    setSelectedPerson(null);
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Top plate */}
      <View style={styles.topPlate}>
        <SmallButton>
          <BackArrowIcon />
        </SmallButton>
        <View style={styles.headerCenter}>
          <View style={styles.statusLed} />
          <Text style={styles.title}>ANTENNA</Text>
        </View>
        <SmallButton>
          <GearIcon />
        </SmallButton>
      </View>

      {/* Range pills */}
      <View style={styles.rangeStrip}>
        {RANGE_OPTIONS.map((opt, i) => (
          <TouchableOpacity
            key={opt.label}
            style={[styles.pill, selectedRange === i && styles.pillActive]}
            onPress={() => setSelectedRange(i)}
          >
            <Text
              style={[
                styles.pillText,
                selectedRange === i && styles.pillTextActive,
              ]}
            >
              {opt.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Radar */}
      <View style={styles.radarAssembly}>
        <RadarView
          people={people}
          selectedId={selectedPerson?.id ?? null}
          onSelectPerson={setSelectedPerson}
          radiusM={RANGE_OPTIONS[selectedRange].meters}
        />
      </View>

      {/* Detail area */}
      <ScrollView style={styles.detailArea} contentContainerStyle={styles.detailContent}>
        {loading && (
          <ActivityIndicator color={colors.orange} style={{ marginTop: 12 }} />
        )}
        {selectedPerson ? (
          <PersonCard
            person={selectedPerson}
            onSkip={handleSkip}
            onConnect={handleConnect}
            onClose={() => setSelectedPerson(null)}
          />
        ) : (
          <Text style={styles.hint}>Tap anyone on the radar</Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.aluBase,
  },
  topPlate: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  smallButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: "hidden",
    // Neumorphic shadows
    shadowColor: "#000",
    shadowOffset: { width: 4, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  smallButtonGradient: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCenter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  statusLed: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.green,
    shadowColor: colors.green,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
  },
  title: {
    fontFamily: fonts.mono,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.5,
    color: colors.engrave,
    textTransform: "uppercase",
  },
  rangeStrip: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 4,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: radii.full,
  },
  pillActive: {
    backgroundColor: "rgba(0,0,0,0.08)",
  },
  pillText: {
    fontFamily: fonts.mono,
    fontSize: 10,
    fontWeight: "600",
    color: colors.engrave,
    letterSpacing: 0.5,
  },
  pillTextActive: {
    color: colors.orange,
  },
  radarAssembly: {
    paddingHorizontal: 16,
  },
  detailArea: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  detailContent: {
    paddingBottom: 8,
  },
  hint: {
    textAlign: "center",
    paddingVertical: 20,
    fontSize: 12,
    color: colors.textFaint,
  },
});
