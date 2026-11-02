import { lazy } from "react";
import { createBrowserRouter } from "react-router";
import { Shell } from "./Shell";
import { RouteError } from "./RouteError";

const Today = lazy(() => import("@/screens/TodayScreen"));
const Calendar = lazy(() => import("@/screens/CalendarScreen"));
const Tasks = lazy(() => import("@/screens/TasksScreen"));
const Health = lazy(() => import("@/screens/HealthScreen"));
const Goals = lazy(() => import("@/screens/GoalsScreen"));
const Settings = lazy(() => import("@/screens/SettingsScreen"));
const Kit = lazy(() => import("@/screens/dev/KitScreen"));

export const router = createBrowserRouter([
  {
    path: "/",
    element: <Shell />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Today /> },
      { path: "calendar", element: <Calendar /> },
      { path: "tasks/*", element: <Tasks /> },
      { path: "health/*", element: <Health /> },
      { path: "goals/*", element: <Goals /> },
      { path: "settings/*", element: <Settings /> },
      { path: "dev/kit", element: <Kit /> },
    ],
  },
]);
