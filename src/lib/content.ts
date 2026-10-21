import { getCollection } from 'astro:content';

export async function loadNotes() {
  const notes = await getCollection('notes', ({ data }) => !data.draft);
  return notes.sort(
    (a, b) =>
      b.data.date.localeCompare(a.data.date) || a.id.localeCompare(b.id),
  );
}

export async function loadProjects() {
  const projects = await getCollection('projects', ({ data }) => !data.draft);
  return projects.sort(
    (a, b) =>
      a.data.order - b.data.order ||
      b.data.date.localeCompare(a.data.date) ||
      a.id.localeCompare(b.id),
  );
}

export async function loadUpdates() {
  const updates = await getCollection('updates', ({ data }) => !data.draft);
  return updates.sort(
    (a, b) =>
      b.data.date.localeCompare(a.data.date) || b.id.localeCompare(a.id),
  );
}

export function formatDate(date: string) {
  return date.replaceAll('-', '.');
}

export async function loadBooks() {
  const books = await getCollection('books', ({ data }) => !data.draft);
  return books.sort(
    (a, b) => a.data.order - b.data.order || a.id.localeCompare(b.id),
  );
}

export const projectStatusLabels = {
  active: '开发中',
  paused: '暂停',
  complete: '已完成',
  archived: '已归档',
} as const;
