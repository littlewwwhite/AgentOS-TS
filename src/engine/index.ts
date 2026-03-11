// input: all engine modules (schema, store, scheduler, checkpoint, memory)
// output: unified public API for the project engine
// pos: Barrel — single import surface for consumers of the engine module

export type {
  ProjectStatus,
  PhaseStatus,
  CheckpointStatus,
  CheckpointType,
  Project,
  Phase,
  Checkpoint,
  CreateProjectInput,
  CreatePhaseInput,
  CreateCheckpointInput,
  UpdateCheckpointInput,
} from "./schema.js";

export { EngineStore } from "./store.js";
export { ProjectScheduler } from "./scheduler.js";
export { createCheckpointTools } from "./checkpoint.js";
export { ProjectMemory } from "./memory.js";
