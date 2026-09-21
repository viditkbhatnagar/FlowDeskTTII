export type Priority = "low" | "medium" | "high" | "critical";
export type Status = "todo" | "progress" | "review" | "done";

export interface Task {
  id: string;
  title: string;
  description?: string;
  project: string;
  priority: Priority;
  status: Status;
  assignee: { name: string; initials: string; color: string };
  dueDate: string; // ISO
  progress: number; // 0-100
  tags?: string[];
  estimatedHours?: number;
}

export interface Project {
  id: string;
  name: string;
  color: string;
  progress: number;
  members: number;
  deadline: string;
  status: "on-track" | "at-risk" | "delayed";
}

const people = [
  { name: "Alex Morgan", initials: "AM", color: "oklch(0.7 0.15 265)" },
  { name: "Priya Shah", initials: "PS", color: "oklch(0.72 0.15 30)" },
  { name: "Jordan Lee", initials: "JL", color: "oklch(0.7 0.15 155)" },
  { name: "Sam Chen", initials: "SC", color: "oklch(0.7 0.15 300)" },
  { name: "Riley Park", initials: "RP", color: "oklch(0.72 0.15 80)" },
];

const today = new Date();
const day = (offset: number) => {
  const d = new Date(today);
  d.setDate(d.getDate() + offset);
  return d.toISOString();
};

export const tasks: Task[] = [
  { id: "T-101", title: "Design onboarding flow v2", project: "Orbit Web", priority: "high", status: "progress", assignee: people[0], dueDate: day(2), progress: 60, tags: ["design", "ux"], estimatedHours: 12 },
  { id: "T-102", title: "Q3 OKR planning doc", project: "Operations", priority: "medium", status: "todo", assignee: people[1], dueDate: day(5), progress: 0, tags: ["planning"], estimatedHours: 4 },
  { id: "T-103", title: "Fix billing webhook retries", project: "Payments", priority: "critical", status: "progress", assignee: people[2], dueDate: day(-1), progress: 40, tags: ["bug"], estimatedHours: 6 },
  { id: "T-104", title: "Write API documentation", project: "Platform", priority: "low", status: "review", assignee: people[3], dueDate: day(7), progress: 85, tags: ["docs"], estimatedHours: 8 },
  { id: "T-105", title: "Refactor auth middleware", project: "Platform", priority: "high", status: "review", assignee: people[2], dueDate: day(3), progress: 90, tags: ["backend"], estimatedHours: 10 },
  { id: "T-106", title: "Launch marketing newsletter", project: "Growth", priority: "medium", status: "done", assignee: people[4], dueDate: day(-2), progress: 100, tags: ["marketing"], estimatedHours: 3 },
  { id: "T-107", title: "Customer interviews — week 22", project: "Research", priority: "medium", status: "todo", assignee: people[1], dueDate: day(4), progress: 10, tags: ["research"], estimatedHours: 6 },
  { id: "T-108", title: "Mobile dashboard responsive pass", project: "Orbit Web", priority: "high", status: "todo", assignee: people[0], dueDate: day(1), progress: 0, tags: ["frontend"], estimatedHours: 5 },
  { id: "T-109", title: "Renew SOC 2 controls review", project: "Operations", priority: "critical", status: "progress", assignee: people[3], dueDate: day(6), progress: 35, tags: ["security"], estimatedHours: 16 },
  { id: "T-110", title: "Build reports export to CSV", project: "Platform", priority: "low", status: "done", assignee: people[4], dueDate: day(-5), progress: 100, tags: ["feature"], estimatedHours: 4 },
  { id: "T-111", title: "Migrate analytics events", project: "Growth", priority: "medium", status: "progress", assignee: people[0], dueDate: day(8), progress: 25, tags: ["data"], estimatedHours: 9 },
  { id: "T-112", title: "Hire senior product designer", project: "Operations", priority: "high", status: "review", assignee: people[1], dueDate: day(10), progress: 70, tags: ["hiring"], estimatedHours: 20 },
];

export const projects: Project[] = [
  { id: "P-1", name: "Orbit Web", color: "oklch(0.65 0.18 265)", progress: 62, members: 6, deadline: day(28), status: "on-track" },
  { id: "P-2", name: "Payments", color: "oklch(0.65 0.18 30)", progress: 38, members: 4, deadline: day(14), status: "at-risk" },
  { id: "P-3", name: "Platform", color: "oklch(0.65 0.15 155)", progress: 80, members: 5, deadline: day(45), status: "on-track" },
  { id: "P-4", name: "Growth", color: "oklch(0.65 0.18 300)", progress: 22, members: 3, deadline: day(60), status: "on-track" },
  { id: "P-5", name: "Operations", color: "oklch(0.65 0.15 80)", progress: 55, members: 4, deadline: day(20), status: "delayed" },
];

export const notifications = [
  { id: "n1", type: "assigned", text: "Priya assigned you 'Q3 OKR planning doc'", time: "12m ago", unread: true },
  { id: "n2", type: "deadline", text: "'Fix billing webhook retries' is overdue", time: "1h ago", unread: true },
  { id: "n3", type: "completed", text: "Riley completed 'Launch marketing newsletter'", time: "3h ago", unread: true },
  { id: "n4", type: "mention", text: "Sam mentioned you in 'Write API documentation'", time: "Yesterday", unread: false },
  { id: "n5", type: "status", text: "'Refactor auth middleware' moved to Review", time: "Yesterday", unread: false },
];

export const productivityTrend = [
  { day: "Mon", completed: 8, planned: 12 },
  { day: "Tue", completed: 11, planned: 13 },
  { day: "Wed", completed: 9, planned: 11 },
  { day: "Thu", completed: 14, planned: 15 },
  { day: "Fri", completed: 12, planned: 14 },
  { day: "Sat", completed: 4, planned: 5 },
  { day: "Sun", completed: 3, planned: 4 },
];

export const teamWorkload = people.map((p, i) => ({
  name: p.name,
  initials: p.initials,
  color: p.color,
  tasks: [7, 5, 9, 6, 4][i],
  capacity: 10,
}));

export const allPeople = people;
