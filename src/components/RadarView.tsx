import React, { useEffect, useRef } from "react";
import {
  View,
  StyleSheet,
  Animated,
  Easing,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
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

  const toRadarPos = (person: NearbyPerson) => {
    const normalizedDist = Math.min(person.distance_m / radiusM, 0.85);
    const r = normalizedDist * 0.35;
    const x = 0.5 + r * Math.cos(person.angle);
    const y = 0.5 - r * Math.sin(person.angle);
    return { x, y };
  };

  return (
    <View style={styles.bezel}>
      {/* Inset shadow overlay — simulates recessed bezel */}
      <View style={styles.bezelInsetTop} pointerEvents="none" />
      <View style={styles.bezelInsetBottom} pointerEvents="none" />

      <View style={styles.glass}>
        {/* Radial glow — warm amber center */}
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

        {/* Sweep animation — gradient wedge */}
        <Animated.View
          style={[
            styles.sweepContainer,
            { transform: [{ rotate: sweepRotation }] },
          ]}
        >
          <LinearGradient
            colors={[
              "rgba(200, 140, 40, 0.08)",
              "rgba(200, 140, 40, 0.03)",
              "transparent",
            ]}
            start={{ x: 0.5, y: 0.5 }}
            end={{ x: 1, y: 0 }}
            style={styles.sweepGradient}
          />
        </Animated.View>

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

        {/* Glass reflection overlay */}
        <LinearGradient
          colors={[
            "rgba(255,255,255,0.4)",
            "transparent",
            "rgba(255,250,240,0.1)",
          ]}
          locations={[0, 0.4, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.glassReflection}
          pointerEvents="none"
        />
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
    // Outer shadow
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    position: "relative",
  },
  bezelInsetTop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 20,
    borderWidth: 2,
    borderTopColor: "rgba(0,0,0,0.12)",
    borderLeftColor: "rgba(0,0,0,0.12)",
    borderBottomColor: "rgba(255,255,255,0.5)",
    borderRightColor: "rgba(255,255,255,0.5)",
    zIndex: 30,
  },
  bezelInsetBottom: {
    position: "absolute",
    top: 2,
    left: 2,
    right: 2,
    bottom: 2,
    borderRadius: 18,
    borderWidth: 1,
    borderTopColor: "rgba(0,0,0,0.06)",
    borderLeftColor: "rgba(0,0,0,0.06)",
    borderBottomColor: "rgba(255,255,255,0.3)",
    borderRightColor: "rgba(255,255,255,0.3)",
    zIndex: 30,
  },
  glass: {
    flex: 1,
    borderRadius: 14,
    backgroundColor: colors.radarScreen,
    overflow: "hidden",
    position: "relative",
    // Inner shadow via border
    borderWidth: 1,
    borderColor: "rgba(160,140,110,0.2)",
  },
  glow: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "transparent",
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
    borderColor: "rgba(180, 165, 140, 0.4)",
  },
  ring1: { width: "30%", height: "30%" },
  ring2: { width: "55%", height: "55%" },
  ring3: {
    width: "80%",
    height: "80%",
    borderStyle: "dashed",
    opacity: 0.7,
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
  sweepContainer: {
    ...StyleSheet.absoluteFillObject,
  },
  sweepGradient: {
    position: "absolute",
    top: 0,
    left: "50%",
    width: "50%",
    height: "50%",
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
  glassReflection: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
  },
});
