import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { AuraSessionProvider } from "@/lib/aura-session";
import { VerifyPage } from "@/pages/VerifyPage";
import { OpsPage } from "@/pages/OpsPage";
import { CuratorPage } from "@/pages/CuratorPage";
import { ApplyPage } from "@/pages/ApplyPage";

export function App() {
  return (
    <BrowserRouter>
      <AuraSessionProvider>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<VerifyPage />} />
            <Route path="/apply" element={<ApplyPage />} />
            <Route path="/ops" element={<OpsPage />} />
            <Route path="/gate" element={<CuratorPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuraSessionProvider>
    </BrowserRouter>
  );
}
