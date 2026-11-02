import { Route, Routes, useParams } from "react-router";
import { GoalsList } from "@/features/goals/GoalsList";
import { GoalDetail } from "@/features/goals/GoalDetail";

function DetailRoute() {
  const { id = "" } = useParams();
  return <GoalDetail key={id} id={id} />;
}

export default function GoalsScreen() {
  return (
    <Routes>
      <Route index element={<GoalsList />} />
      <Route path="new" element={<GoalsList createOpen />} />
      <Route path=":id" element={<DetailRoute />} />
    </Routes>
  );
}
