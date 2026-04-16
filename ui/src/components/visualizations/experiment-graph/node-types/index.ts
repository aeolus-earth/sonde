/**
 * Node-type registry for React Flow.
 *
 * Each node component lives in its own file; this module assembles the
 * `nodeTypes` object that `<ReactFlow nodeTypes={...}>` consumes, and
 * re-exports individual components / data types for anyone who needs
 * them (tests, storybook, etc.).
 */

import { memo } from "react";

import { DirectionNode, type DirectionNodeData } from "./direction-node";
import { ExperimentNode, type ExperimentNodeData } from "./experiment-node";
import { FindingNode, type FindingNodeData } from "./finding-node";
import { ProjectNode, type ProjectNodeData } from "./project-node";
import { QuestionNode, type QuestionNodeData } from "./question-node";
import { UngroupedNode, type UngroupedNodeData } from "./ungrouped-node";

export {
  DirectionNode,
  ExperimentNode,
  FindingNode,
  ProjectNode,
  QuestionNode,
  UngroupedNode,
};

export type {
  DirectionNodeData,
  ExperimentNodeData,
  FindingNodeData,
  ProjectNodeData,
  QuestionNodeData,
  UngroupedNodeData,
};

export { type NodeAction } from "./types";

export const nodeTypes = {
  experiment: memo(ExperimentNode),
  project: memo(ProjectNode),
  direction: memo(DirectionNode),
  question: memo(QuestionNode),
  ungrouped: memo(UngroupedNode),
  finding: memo(FindingNode),
};
