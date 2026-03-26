import React, { useRef, useEffect } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { StatusBar } from "expo-status-bar";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { colors, fonts } from "./src/config/theme";

import RadarScreen from "./src/screens/RadarScreen";
import ProfileScreen from "./src/screens/ProfileScreen";

const Tab = createBottomTabNavigator();

const TAB_COUNT = 3;

function CustomTabBar({
  state,
  descriptors,
  navigation,
}: {
  state: any;
  descriptors: any;
  navigation: any;
}) {
  const slideAnim = useRef(new Animated.Value(state.index)).current;

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: state.index,
      useNativeDriver: false,
      tension: 68,
      friction: 12,
    }).start();
  }, [state.index]);

  const indicatorLeft = slideAnim.interpolate({
    inputRange: [0, TAB_COUNT - 1],
    outputRange: ["0%", `${((TAB_COUNT - 1) / TAB_COUNT) * 100}%`],
  });

  return (
    <View style={styles.tabBarContainer}>
      <View style={styles.tabTrack}>
        {/* Sliding indicator with gradient */}
        <Animated.View
          style={[
            styles.tabIndicatorOuter,
            {
              left: indicatorLeft,
              width: `${100 / TAB_COUNT}%` as unknown as number,
            },
          ]}
        >
          <LinearGradient
            colors={["#f0ece6", "#d4cfc8"]}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={styles.tabIndicatorGradient}
          >
            <View style={styles.tabIndicatorAccent} />
          </LinearGradient>
        </Animated.View>

        {state.routes.map((route: any, index: number) => {
          const isFocused = state.index === index;

          const onPress = () => {
            const event = navigation.emit({
              type: "tabPress",
              target: route.key,
              canPreventDefault: true,
            });
            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          return (
            <TouchableOpacity
              key={route.key}
              style={styles.tabItem}
              onPress={onPress}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.tabLabel,
                  isFocused && styles.tabLabelActive,
                ]}
              >
                {route.name.toUpperCase()}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

// Placeholder for Matches screen — reuses ProfileScreen for now
function MatchesScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.aluBase, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: colors.textFaint, fontFamily: fonts.mono, fontSize: 12 }}>MATCHES — COMING SOON</Text>
    </View>
  );
}

export default function App() {
  return (
    <NavigationContainer>
      <StatusBar style="dark" />
      <Tab.Navigator
        initialRouteName="Nearby"
        tabBar={(props) => <CustomTabBar {...props} />}
        screenOptions={{
          headerShown: false,
        }}
      >
        <Tab.Screen name="Profile" component={ProfileScreen} />
        <Tab.Screen name="Nearby" component={RadarScreen} />
        <Tab.Screen name="Matches" component={MatchesScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  tabBarContainer: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    backgroundColor: colors.aluBase,
  },
  tabTrack: {
    flexDirection: "row",
    backgroundColor: colors.aluDark,
    borderRadius: 20,
    padding: 4,
    position: "relative",
    // Inset shadow simulation
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -1 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    // Additional border to simulate inner shadow
    borderWidth: 1,
    borderTopColor: "rgba(0,0,0,0.15)",
    borderLeftColor: "rgba(0,0,0,0.1)",
    borderBottomColor: "rgba(255,255,255,0.4)",
    borderRightColor: "rgba(255,255,255,0.3)",
  },
  tabIndicatorOuter: {
    position: "absolute",
    top: 4,
    bottom: 4,
    zIndex: 1,
    // Outer shadow of indicator
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 4,
  },
  tabIndicatorGradient: {
    flex: 1,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "flex-end",
    overflow: "hidden",
  },
  tabIndicatorAccent: {
    marginBottom: 6,
    width: 16,
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.orange,
    shadowColor: colors.orangeGlow,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 6,
  },
  tabItem: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    zIndex: 2,
  },
  tabLabel: {
    fontFamily: fonts.mono,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
    color: colors.engrave,
    textTransform: "uppercase",
  },
  tabLabelActive: {
    color: colors.engrave,
  },
});
