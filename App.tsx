import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { StatusBar } from "expo-status-bar";
import { View, Text, StyleSheet } from "react-native";
import { colors, fonts } from "./src/config/theme";

import RadarScreen from "./src/screens/RadarScreen";
import ProfileScreen from "./src/screens/ProfileScreen";

const Tab = createBottomTabNavigator();

function TabIcon({ label, active }: { label: string; active: boolean }) {
  return (
    <Text style={[styles.tabIcon, active && styles.tabIconActive]}>
      {label === "Radar" ? "📡" : "🪪"}
    </Text>
  );
}

export default function App() {
  return (
    <NavigationContainer>
      <StatusBar style="dark" />
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarStyle: styles.tabBar,
          tabBarActiveTintColor: colors.orange,
          tabBarInactiveTintColor: colors.engrave,
          tabBarLabelStyle: styles.tabLabel,
        }}
      >
        <Tab.Screen
          name="Radar"
          component={RadarScreen}
          options={{
            tabBarIcon: ({ focused }) => (
              <TabIcon label="Radar" active={focused} />
            ),
          }}
        />
        <Tab.Screen
          name="Profile"
          component={ProfileScreen}
          options={{
            tabBarIcon: ({ focused }) => (
              <TabIcon label="Profile" active={focused} />
            ),
          }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: colors.aluDark,
    borderTopWidth: 0,
    paddingTop: 4,
    paddingBottom: 4,
    height: 56,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
  tabLabel: {
    fontFamily: fonts.mono,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
  },
  tabIcon: {
    fontSize: 20,
  },
  tabIconActive: {
    // slight glow effect via shadow
  },
});
