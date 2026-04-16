export const ACTIVATION_STORAGE_KEY = "sonde-activation-auth";

type ActivationStorage = Pick<Storage, "removeItem">;

export function clearActivationStorage(
  storage: ActivationStorage | undefined = typeof window !== "undefined"
    ? window.localStorage
    : undefined
): void {
  storage?.removeItem(ACTIVATION_STORAGE_KEY);
  storage?.removeItem(`${ACTIVATION_STORAGE_KEY}-code-verifier`);
}
