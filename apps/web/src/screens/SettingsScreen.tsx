import { Route, Routes } from "react-router";
import { SettingsHome } from "@/features/settings/SettingsHome";
import { McpGuide } from "@/features/settings/McpGuide";
import { ActivityScreen } from "@/features/settings/ActivityScreen";

export default function SettingsScreen() {
  return (
    <Routes>
      <Route index element={<SettingsHome />} />
      <Route path="mcp" element={<McpGuide />} />
      <Route path="activity" element={<ActivityScreen />} />
    </Routes>
  );
}
