/**
 * Todo types for task tracking
 */

export type TodoStatus = "pending" | "in_progress" | "completed";

export interface TodoItem {
  id: string;
  content: string; // Imperative form: "Run tests"
  status: TodoStatus;
  activeForm: string; // Present continuous: "Running tests"
  createdAt: number;
  updatedAt: number;
  priority?: "high" | "medium" | "low";
}

export interface TodoInput {
  content: string;
  status: TodoStatus;
  activeForm: string;
}

/**
 * Serializable format for persistence
 */
export interface TodoStorageData {
  todos: TodoItem[];
  lastUpdated: number;
}
