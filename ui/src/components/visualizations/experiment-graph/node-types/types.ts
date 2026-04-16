/**
 * Shared types for the experiment-graph node components.
 *
 * Kept tiny on purpose — each node component owns its own `Data` type;
 * only truly shared shapes live here.
 */

export type NodeAction = (() => void) | undefined;
