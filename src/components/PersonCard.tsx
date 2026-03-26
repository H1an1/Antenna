import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
} from "react-native";
import { colors, fonts, radii } from "../config/theme";
import type { NearbyPerson } from "../types";

interface PersonCardProps {
  person: NearbyPerson;
  onSkip: () => void;
  onConnect: () => void;
  onClose: () => void;
}

function formatDistance(m: number): string {
  if (m < 1000) return `~${Math.round(m)}m`;
  return `~${(m / 1000).toFixed(1)}km`;
}

export default function PersonCard({
  person,
  onSkip,
  onConnect,
  onClose,
}: PersonCardProps) {
  const bio = [person.line1, person.line2, person.line3]
    .filter(Boolean)
    .join(" · ");

  const reason = person.match?.reason;
  const tags = bio
    .split(/[,·]/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && t.length < 20)
    .slice(0, 4);

  return (
    <View style={styles.card}>
      <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
        <Text style={styles.closeText}>✕</Text>
      </TouchableOpacity>

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.emojiCircle}>
          <Text style={styles.emojiText}>{person.emoji}</Text>
        </View>
        <View>
          <Text style={styles.name}>
            {person.display_name ?? "Anonymous"}
          </Text>
          <Text style={styles.dist}>
            {formatDistance(person.distance_m)}
          </Text>
        </View>
      </View>

      {/* Bio */}
      {bio ? <Text style={styles.bio}>{bio}</Text> : null}

      {/* Agent reason */}
      {reason ? (
        <View style={styles.reasonBox}>
          <Text style={styles.reasonText}>{reason}</Text>
        </View>
      ) : null}

      {/* Tags */}
      {tags.length > 0 && (
        <View style={styles.tags}>
          {tags.map((tag, i) => (
            <View key={i} style={styles.tag}>
              <Text style={styles.tagText}>{tag}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Actions */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.btn, styles.btnSkip]}
          onPress={onSkip}
        >
          <Text style={styles.btnSkipText}>Skip</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btn, styles.btnConnect]}
          onPress={onConnect}
        >
          <Text style={styles.btnConnectText}>Connect</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceLight,
    borderRadius: radii.lg,
    padding: 18,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    borderWidth: 1,
    borderColor: "rgba(200,185,160,0.2)",
  },
  closeBtn: {
    position: "absolute",
    top: 12,
    right: 14,
    padding: 4,
    zIndex: 1,
  },
  closeText: {
    fontSize: 14,
    color: colors.textFaint,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 10,
  },
  emojiCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.white,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "rgba(200,185,160,0.4)",
  },
  emojiText: {
    fontSize: 22,
  },
  name: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.text,
    letterSpacing: 0.2,
  },
  dist: {
    fontFamily: fonts.mono,
    fontSize: 11,
    color: colors.amber,
    letterSpacing: 0.5,
    marginTop: 2,
  },
  bio: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: 10,
  },
  reasonBox: {
    marginBottom: 12,
    padding: 10,
    paddingLeft: 12,
    backgroundColor: "rgba(200,185,160,0.1)",
    borderRadius: radii.md,
    borderLeftWidth: 2,
    borderLeftColor: colors.orange,
  },
  reasonText: {
    fontSize: 12,
    color: colors.textFaint,
    lineHeight: 18,
  },
  tags: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 14,
  },
  tag: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radii.sm,
    backgroundColor: "rgba(180,160,130,0.12)",
  },
  tagText: {
    fontFamily: fonts.mono,
    fontSize: 10,
    color: colors.textSecondary,
    letterSpacing: 0.3,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
  },
  btn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radii.md,
    alignItems: "center",
  },
  btnSkip: {
    backgroundColor: "rgba(180,165,140,0.15)",
  },
  btnSkipText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textSecondary,
  },
  btnConnect: {
    backgroundColor: colors.orange,
    shadowColor: colors.orange,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  btnConnectText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.warmWhite,
  },
});
