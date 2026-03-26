import React, { useEffect, useRef } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Animated } from "react-native";
import { colors, fonts } from "../config/theme";

interface PersonPinProps {
  emoji: string;
  distance_m: number;
  isActive: boolean;
  onPress: () => void;
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

const SIGNAL_CONFIG = {
  strong: {
    pulseDuration: 2500,
    pulseMinOpacity: 0.7,
    borderColor: "#bab1a3",
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  medium: {
    pulseDuration: 3500,
    pulseMinOpacity: 0.7,
    borderColor: colors.borderWarm,
    shadowOpacity: 0.15,
    shadowRadius: 6,
  },
  weak: {
    pulseDuration: 4500,
    pulseMinOpacity: 0.7,
    borderColor: "#d4ccc0",
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
};

export default function PersonPin({
  emoji,
  distance_m,
  isActive,
  onPress,
  x,
  y,
}: PersonPinProps) {
  const signal = getSignalStrength(distance_m);
  const config = SIGNAL_CONFIG[signal];
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: config.pulseMinOpacity,
          duration: config.pulseDuration / 2,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: config.pulseDuration / 2,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [signal]);

  return (
    <TouchableOpacity
      style={[
        styles.container,
        {
          left: `${x * 100}%` as unknown as number,
          top: `${y * 100}%` as unknown as number,
        },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Animated.View
        style={[
          styles.dot,
          {
            borderColor: isActive ? colors.orange : config.borderColor,
            shadowColor: isActive ? colors.orange : "rgba(160,140,110,1)",
            shadowOpacity: isActive ? 0.3 : config.shadowOpacity,
            shadowRadius: isActive ? 12 : config.shadowRadius,
            opacity: pulseAnim,
          },
        ]}
      >
        <Text style={styles.emoji}>{emoji}</Text>
      </Animated.View>
      <Text style={styles.distance}>{formatDistance(distance_m)}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    alignItems: "center",
    transform: [{ translateX: -17 }, { translateY: -17 }],
    gap: 3,
  },
  dot: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#ffffff",
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    shadowOffset: { width: 0, height: 1 },
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
