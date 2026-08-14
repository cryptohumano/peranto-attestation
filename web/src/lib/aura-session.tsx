import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getAura, getHolderInfo, requestSession } from "@/lib/aura";

type AuraSessionValue = {
  did: string | null;
  address: string | null;
  auraReady: boolean | null;
  busy: boolean;
  error: string | null;
  connected: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  clearError: () => void;
  redetect: () => void;
};

const AuraSessionContext = createContext<AuraSessionValue | null>(null);

export function AuraSessionProvider({ children }: { children: ReactNode }) {
  const [did, setDid] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [auraReady, setAuraReady] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const redetect = useCallback(() => {
    setAuraReady(Boolean(getAura()));
  }, []);

  useEffect(() => {
    redetect();
    const t = setInterval(redetect, 2500);
    return () => clearInterval(t);
  }, [redetect]);

  const disconnect = useCallback(() => {
    setDid(null);
    setAddress(null);
    setError(null);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const connect = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const aura = getAura();
      setAuraReady(Boolean(aura));
      if (!aura) {
        throw new Error("AURA_NOT_FOUND");
      }
      await requestSession(aura);
      const info = await getHolderInfo(aura);
      setDid(info.did);
      setAddress(info.address || null);
    } catch (e) {
      setDid(null);
      setAddress(null);
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      setBusy(false);
    }
  }, []);

  const value = useMemo(
    () => ({
      did,
      address,
      auraReady,
      busy,
      error,
      connected: Boolean(did),
      connect,
      disconnect,
      clearError,
      redetect,
    }),
    [
      did,
      address,
      auraReady,
      busy,
      error,
      connect,
      disconnect,
      clearError,
      redetect,
    ]
  );

  return (
    <AuraSessionContext.Provider value={value}>
      {children}
    </AuraSessionContext.Provider>
  );
}

export function useAuraSession() {
  const ctx = useContext(AuraSessionContext);
  if (!ctx) throw new Error("useAuraSession outside AuraSessionProvider");
  return ctx;
}
