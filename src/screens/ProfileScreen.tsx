import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  Switch,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { colors, fonts, radii, spacing } from "../config/theme";
import { getDeviceId } from "../services/deviceId";
import { updateProfile } from "../services/api";

export default function ProfileScreen() {
  const [deviceId, setDeviceId] = useState("");
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [line3, setLine3] = useState("");
  const [visible, setVisible] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getDeviceId().then(async (id) => {
      setDeviceId(id);
      // Load existing profile from Supabase
      try {
        const { getProfile } = await import("../services/api");
        const profile = await getProfile(id);
        if (profile) {
          setLine1(profile.line1 || "");
          setLine2(profile.line2 || "");
          setLine3(profile.line3 || "");
          setVisible(profile.visible ?? true);
        }
      } catch {
        // No profile yet — that's fine
      }
    });
  }, []);

  const handleSave = async () => {
    if (!deviceId) return;
    setSaving(true);
    try {
      await updateProfile(deviceId, {
        line1: line1 || null,
        line2: line2 || null,
        line3: line3 || null,
        visible,
      });
      Alert.alert("Saved", "Your profile has been updated.");
    } catch {
      Alert.alert("Error", "Could not save profile. Check your connection.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>ANTENNA</Text>
            <Text style={styles.subtitle}>Your card</Text>
          </View>

          {/* Emoji avatar */}
          <View style={styles.avatarRow}>
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarEmoji}>🦐</Text>
            </View>
          </View>

          {/* Line inputs */}
          <View style={styles.linesContainer}>
            <LineInput
              label="LN.1"
              value={line1}
              onChangeText={setLine1}
              placeholder="Who you are"
            />
            <LineInput
              label="LN.2"
              value={line2}
              onChangeText={setLine2}
              placeholder="What you do"
            />
            <LineInput
              label="LN.3"
              value={line3}
              onChangeText={setLine3}
              placeholder="What you're into"
            />
          </View>

          {/* Visible toggle */}
          <View style={styles.toggleRow}>
            <View>
              <Text style={styles.toggleLabel}>Visible</Text>
              <Text style={styles.toggleHint}>
                Let nearby people discover you
              </Text>
            </View>
            <Switch
              value={visible}
              onValueChange={setVisible}
              trackColor={{
                false: colors.shellShadow,
                true: colors.orange,
              }}
              thumbColor={colors.white}
            />
          </View>

          {/* Save button */}
          <TouchableOpacity
            style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
            onPress={handleSave}
            disabled={saving}
          >
            <Text style={styles.saveBtnText}>
              {saving ? "Saving..." : "Save"}
            </Text>
          </TouchableOpacity>

          {/* Device ID (debug) */}
          <Text style={styles.deviceIdText}>
            {deviceId ? `ID: ${deviceId.slice(0, 8)}...` : "Loading..."}
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function LineInput({
  label,
  value,
  onChangeText,
  placeholder,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder: string;
}) {
  return (
    <View style={styles.lineRow}>
      <Text style={styles.lineLabel}>{label}</Text>
      <TextInput
        style={styles.lineInput}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textFaint}
        maxLength={100}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.aluBase,
  },
  content: {
    padding: spacing.lg,
    paddingTop: spacing.md,
  },
  header: {
    alignItems: "center",
    marginBottom: spacing.lg,
  },
  title: {
    fontFamily: fonts.mono,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.5,
    color: colors.engrave,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 20,
    fontWeight: "600",
    color: colors.text,
  },
  avatarRow: {
    alignItems: "center",
    marginBottom: spacing.lg,
  },
  avatarCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.white,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.border,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  avatarEmoji: {
    fontSize: 32,
  },
  linesContainer: {
    gap: 12,
    marginBottom: spacing.lg,
  },
  lineRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceLight,
    borderRadius: radii.md,
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: "rgba(200,185,160,0.2)",
  },
  lineLabel: {
    fontFamily: fonts.mono,
    fontSize: 11,
    fontWeight: "700",
    color: colors.orange,
    letterSpacing: 0.5,
    width: 40,
  },
  lineInput: {
    flex: 1,
    fontSize: 14,
    color: colors.text,
    padding: 0,
  },
  toggleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: colors.surfaceLight,
    borderRadius: radii.md,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: "rgba(200,185,160,0.2)",
  },
  toggleLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.text,
  },
  toggleHint: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
  },
  saveBtn: {
    backgroundColor: colors.orange,
    borderRadius: radii.md,
    paddingVertical: 14,
    alignItems: "center",
    shadowColor: colors.orange,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    marginBottom: spacing.md,
  },
  saveBtnDisabled: {
    opacity: 0.6,
  },
  saveBtnText: {
    color: colors.warmWhite,
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  deviceIdText: {
    textAlign: "center",
    fontFamily: fonts.mono,
    fontSize: 10,
    color: colors.textFaint,
    letterSpacing: 0.5,
  },
});
