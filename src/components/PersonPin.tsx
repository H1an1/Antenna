import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { colors, fonts } from "../config/theme";

interface PersonPinProps {
  emoji: string;
  distance_m: number;
  isActive: boolean;
  onPress: () => void;
  // Position as percentage of radar diameter
  x: number; // 0-1
  y: number; // 0-1
}

function formatDistance(m: number): string {
  if (m < 1000) return `~${Math.round(m)}m`;
  return `~${(m / 1000).toFixed(1)}km`;
}

function getSignalStrength(m: number): "strong" | "medium" | "weak" {
  if (m < 200) return "strong";
  if (m < 500) return "medium";
  return "weak";
}

export default function PersonPin({
  emoji,
  distance_m,
  isActive,
  onPress,
  x,
  y,
}: PersonPinProps) {
  const signal = getSignalStrength(distance_m);
  const opacity = signal === "strong" ? 1 : signal === "medium" ? 0.85 : 0.65;

  return (
    <TouchableOpacity
      style={[
        styles.container,
        {
          left: `${x * 100}%` as unknown as number,
          top: `${y * 100}%` as unknown as number,
          opacity,
        },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View
        style={[
          styles.dot,
          isActive && styles.dotActive,
          signal === "strong" && styles.dotStrong,
        ]}
      >
        <Text style={styles.emoji}>{emoji}</Text>
      </View>
      <Text style={styles.distance}>{formatDistance(distance_m)}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    alignItems: "center",
    transform: [{ translateX: -17 }, { translateY: -17 }],
    gap: 2,
  },
  dot: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.white,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  dotActive: {
    borderColor: colors.orange,
    shadowColor: colors.orange,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  dotStrong: {
    shadowColor: colors.shellShadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  emoji: {
    fontSize: 16,
  },
  distance: {
    fontFamily: fonts.mono,
    fontSize: 8,
    color: colors.textSecondary,
    letterSpacing: 0.3,
  },
});
