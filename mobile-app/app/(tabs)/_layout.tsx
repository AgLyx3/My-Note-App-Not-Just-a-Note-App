import { Tabs } from "expo-router";

export default function TabsLayout() {
  return (
    <Tabs
      initialRouteName="capture"
      screenOptions={{
        headerStyle: { backgroundColor: "#f4f4f5" },
        headerTintColor: "#18181b",
        headerShadowVisible: false,
        headerTitleStyle: { fontWeight: "600" },
        tabBarStyle: { backgroundColor: "#f4f4f5", borderTopColor: "#d4d4d8" },
        tabBarActiveTintColor: "#18181b",
        tabBarInactiveTintColor: "#71717a"
      }}
    >
      <Tabs.Screen name="capture" options={{ title: "Capture", tabBarLabel: "Capture" }} />
      <Tabs.Screen name="gallery" options={{ title: "Gallery", tabBarLabel: "Gallery" }} />
    </Tabs>
  );
}
