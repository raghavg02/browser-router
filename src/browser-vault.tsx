import { useState } from "react";
import { VaultUnlockView } from "./components/vault/VaultUnlockView";
import { VaultMainView } from "./components/vault/VaultMainView";

export default function Command() {
  const [vaultKey, setVaultKey] = useState<Buffer | null>(null);

  if (!vaultKey) {
    return <VaultUnlockView onUnlocked={(key) => setVaultKey(key)} />;
  }

  return <VaultMainView vaultKey={vaultKey} onLock={() => setVaultKey(null)} />;
}
