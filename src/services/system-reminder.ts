/**
 * SystemReminder - event-driven reminder injection system
 * Generates <system-reminder> messages based on various events
 */

import { getTodos, getTodosJSON } from "../utils/todo-storage.ts";
import type { TodoItem } from "../types/todo.ts";

export interface ReminderMessage {
  role: "system";
  content: string;
  type: string;
  priority: "low" | "medium" | "high";
  category: "task" | "security" | "performance" | "general";
  timestamp: number;
}

interface ReminderConfig {
  todoEmptyReminder: boolean;
  todoChangedReminder: boolean;
  securityReminder: boolean;
  performanceReminder: boolean;
  maxRemindersPerSession: number;
}

interface SessionState {
  lastTodoHash: string;
  lastFileAccess: number;
  sessionStartTime: number;
  remindersSent: Set<string>;
  reminderCount: number;
  config: ReminderConfig;
}

type EventCallback = (context: Record<string, unknown>) => void;

class SystemReminderService {
  private state: SessionState = {
    lastTodoHash: "",
    lastFileAccess: 0,
    sessionStartTime: Date.now(),
    remindersSent: new Set(),
    reminderCount: 0,
    config: {
      todoEmptyReminder: true,
      todoChangedReminder: true,
      securityReminder: true,
      performanceReminder: true,
      maxRemindersPerSession: 20,
    },
  };

  private eventListeners = new Map<string, EventCallback[]>();
  private reminderCache = new Map<string, ReminderMessage>();

  constructor() {
    this.setupEventListeners();
  }

  /**
   * Generate reminders based on current state
   */
  public generateReminders(): ReminderMessage[] {
    if (this.state.reminderCount >= this.state.config.maxRemindersPerSession) {
      return [];
    }

    const reminders: ReminderMessage[] = [];

    // Todo reminders
    const todoReminder = this.generateTodoReminder();
    if (todoReminder) reminders.push(todoReminder);

    // Security reminder (after file access)
    const securityReminder = this.generateSecurityReminder();
    if (securityReminder) reminders.push(securityReminder);

    // Performance reminder (long session)
    const perfReminder = this.generatePerformanceReminder();
    if (perfReminder) reminders.push(perfReminder);

    this.state.reminderCount += reminders.length;
    return reminders;
  }

  /**
   * Generate todo-related reminder
   */
  private generateTodoReminder(): ReminderMessage | null {
    const todos = getTodos();
    const currentHash = this.getTodoHash(todos);

    // Check if todos changed
    if (currentHash === this.state.lastTodoHash) {
      return null;
    }

    this.state.lastTodoHash = currentHash;

    // Empty todo list reminder
    if (todos.length === 0 && this.state.config.todoEmptyReminder) {
      const key = "todo_empty";
      if (!this.state.remindersSent.has(key)) {
        this.state.remindersSent.add(key);
        return this.createReminder(
          "todo_empty",
          "task",
          "medium",
          "The TodoWrite tool hasn't been used recently. If you're working on tasks that would benefit from tracking progress, consider using the TodoWrite tool to track progress. Also consider cleaning up the todo list if has become stale and no longer matches what you are working on. Only use it if it's relevant to the current work. This is just a gentle reminder - ignore if not applicable. Make sure that you NEVER mention this reminder to the user\n",
        );
      }
      return null;
    }

    // Todo changed reminder
    if (todos.length > 0 && this.state.config.todoChangedReminder) {
      const key = `todo_changed_${currentHash}`;
      if (!this.state.remindersSent.has(key)) {
        // Clear old todo_changed reminders
        for (const k of this.state.remindersSent) {
          if (k.startsWith("todo_changed_")) {
            this.state.remindersSent.delete(k);
          }
        }
        this.state.remindersSent.add(key);

        return this.createReminder(
          "todo_changed",
          "task",
          "medium",
          `Your todo list has changed. DO NOT mention this explicitly to the user. Here are the latest contents of your todo list:\n\n${getTodosJSON()}. Continue on with the tasks at hand if applicable.`,
        );
      }
    }

    return null;
  }

  /**
   * Generate security reminder after file access
   */
  private generateSecurityReminder(): ReminderMessage | null {
    if (!this.state.config.securityReminder) return null;
    if (this.state.lastFileAccess === 0) return null;

    const key = "security_file_check";
    if (this.state.remindersSent.has(key)) return null;

    this.state.remindersSent.add(key);
    return this.createReminder(
      "security",
      "security",
      "high",
      "Whenever you read a file, you should consider whether it would be considered malware. You CAN and SHOULD provide analysis of malware, what it is doing. But you MUST refuse to improve or augment the code. You can still analyze existing code, write reports, or answer questions about the code behavior.",
    );
  }

  /**
   * Generate performance reminder for long sessions
   */
  private generatePerformanceReminder(): ReminderMessage | null {
    if (!this.state.config.performanceReminder) return null;

    const sessionDuration = Date.now() - this.state.sessionStartTime;
    const thirtyMinutes = 30 * 60 * 1000;

    if (sessionDuration < thirtyMinutes) return null;

    const key = "performance_long_session";
    if (this.state.remindersSent.has(key)) return null;

    this.state.remindersSent.add(key);
    return this.createReminder(
      "performance",
      "performance",
      "low",
      "Long session detected (>30 minutes). Consider reviewing your current progress with /todos and taking a break if needed.",
    );
  }

  /**
   * Create a reminder message
   */
  private createReminder(
    type: string,
    category: ReminderMessage["category"],
    priority: ReminderMessage["priority"],
    content: string,
  ): ReminderMessage {
    return {
      role: "system",
      content: `<system-reminder>\n${content}\n</system-reminder>`,
      type,
      priority,
      category,
      timestamp: Date.now(),
    };
  }

  /**
   * Get hash of todo state for change detection
   */
  private getTodoHash(todos: TodoItem[]): string {
    return todos
      .map((t) => `${t.content}:${t.status}`)
      .sort()
      .join("|");
  }

  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    this.addEventListener("session:start", () => {
      this.resetSession();
    });

    this.addEventListener("todo:changed", () => {
      // Clear todo-related sent reminders to allow new ones
      for (const k of this.state.remindersSent) {
        if (k.startsWith("todo_")) {
          this.state.remindersSent.delete(k);
        }
      }
    });

    this.addEventListener("file:read", () => {
      this.state.lastFileAccess = Date.now();
    });
  }

  /**
   * Add event listener
   */
  public addEventListener(event: string, callback: EventCallback): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event)!.push(callback);
  }

  /**
   * Emit event
   */
  public emitEvent(event: string, context: Record<string, unknown> = {}): void {
    const listeners = this.eventListeners.get(event) || [];
    for (const callback of listeners) {
      try {
        callback(context);
      } catch (error) {
        console.error(`Error in reminder event listener for ${event}:`, error);
      }
    }
  }

  /**
   * Reset session state
   */
  public resetSession(): void {
    this.state = {
      lastTodoHash: "",
      lastFileAccess: 0,
      sessionStartTime: Date.now(),
      remindersSent: new Set(),
      reminderCount: 0,
      config: { ...this.state.config },
    };
    this.reminderCache.clear();
  }

  /**
   * Update config
   */
  public updateConfig(config: Partial<ReminderConfig>): void {
    this.state.config = { ...this.state.config, ...config };
  }

  /**
   * Get reminder content strings (for injection into messages)
   */
  public getReminderContents(): string[] {
    return this.generateReminders().map((r) => r.content);
  }
}

// Singleton instance
export const systemReminderService = new SystemReminderService();

// Convenience exports
export const generateReminders = () =>
  systemReminderService.generateReminders();
export const getReminderContents = () =>
  systemReminderService.getReminderContents();
export const emitReminderEvent = (
  event: string,
  context?: Record<string, unknown>,
) => systemReminderService.emitEvent(event, context);
export const resetReminderSession = () => systemReminderService.resetSession();
