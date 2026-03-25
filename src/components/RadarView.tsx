import React, { useEffect, useRef } from "react";
import {
  View,
  StyleSheet,
  Animated,
  Easing,
  Dimensions,
} from "react-native";
import { colors } from "../config/theme";
import PersonPin from "./PersonPin";
import type { NearbyPerson } from "../types";

interface RadarViewProps {
  people: NearbyPerson[];
  selectedId: string | null;
  onSelectPerson: (person: NearbyPerson) => void;
  radiusM: number;
}

export default function RadarView({
  people,
  selectedId,
  onSelectPerson,
  radiusM,
}: RadarViewProps) {
  const sweepAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(sweepAnim, {
        toValue: 1,
        duration: 12000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    anim.start();
    return () => anim.stop();
  }, [sweepAnim]);

  const sweepRotation = sweepAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  // Convert distance + angle to x,y position on radar (0-1 range)
  const toRadarPos = (person: NearbyPerson) => {
    const normalizedDist = Math.min(person.distance_m / radiusM, 0.95);
    const r = normalizedDist * 0.45; // max 45% from center
    const x = 0.5 + r * Math.cos(person.angle);
    const y = 0.5 - r * Math.sin(person.angle); // y inverted
    return { x, y };
  };

  return (
    <View style={styles.bezel}>
      <View style={styles.glass}>
        {/* Radial glow */}
        <View style={styles.glow} />

        {/* Concentric rings */}
        <View style={styles.ringsContainer}>
          <View style={[styles.ring, styles.ring1]} />
          <View style={[styles.ring, styles.ring2]} />
          <View style={[styles.ring, styles.ring3]} />
        </View>

        {/* Crosshairs */}
        <View style={styles.crosshairV} />
        <View style={styles.crosshairH} />

        {/* Sweep animation */}
        <Animated.View
          style={[
            styles.sweep,
            { transform: [{ rotate: sweepRotation }] },
          ]}
        />

        {/* Center dot (you) */}
        <View style={styles.centerDot} />

        {/* People pins */}
        {people.map((person) => {
          const pos = toRadarPos(person);
          return (
            <PersonPin
              key={person.id}
              emoji={person.emoji}
              distance_m={person.distance_m}
              isActive={selectedId === person.id}
              onPress={() => onSelectPerson(person)}
              x={pos.x}
              y={pos.y}
            />
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bezel: {
    aspectRatio: 1,
    maxWidth: 340,
    width: "100%",
    alignSelf: "center",
    borderRadius: 20,
    backgroundColor: colors.aluBase,
    padding: 6,
    // Neumorphic inset shadow
    shadowColor: "#000",
    shadowOffset: { width: 6, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
  glass: {
    flex: 1,
    borderRadius: 14,
    backgroundColor: colors.radarScreen,
    overflow: "hidden",
    position: "relative",
  },
  glow: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "transparent",
    // Warm center glow — approximated
    opacity: 0.6,
  },
  ringsContainer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  ring: {
    position: "absolute",
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: "rgba(180, 165, 140, 0.25)",
  },
  ring1: { width: "30%", height: "30%" },
  ring2: { width: "55%", height: "55%" },
  ring3: {
    width: "80%",
    height: "80%",
    borderStyle: "dashed",
    opacity: 0.5,
  },
  crosshairV: {
    position: "absolute",
    width: 1,
    height: "100%",
    left: "50%",
    backgroundColor: "rgba(160, 140, 110, 0.12)",
  },
  crosshairH: {
    position: "absolute",
    height: 1,
    width: "100%",
    top: "50%",
    backgroundColor: "rgba(160, 140, 110, 0.12)",
  },
  sweep: {
    ...StyleSheet.absoluteFillObject,
    // Conic gradient approximation — a semi-transparent wedge
    backgroundColor: "transparent",
    borderTopColor: "rgba(200, 140, 40, 0.06)",
    borderRightColor: "transparent",
    borderBottomColor: "transparent",
    borderLeftColor: "transparent",
    borderWidth: 170,
    borderRadius: 9999,
  },
  centerDot: {
    position: "absolute",
    top: "50%",
    left: "50%",
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.orange,
    marginLeft: -4,
    marginTop: -4,
    shadowColor: colors.orange,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
    zIndex: 5,
  },
});
