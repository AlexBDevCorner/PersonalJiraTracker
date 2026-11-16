import {
  normalizeIssueKey,
  searchJiraIssuesByJql,
  type JiraClient,
} from "../../jira";

export type BoardStatus = {
  id: string;
  name: string;
  statusCategory?: { key?: string };
};

export type BoardIssue = {
  issueKey: string;
  summary: string;
  status: BoardStatus;
  projectKey: string;
  issueTypeId: string;
};

export type BoardData = {
  issues: BoardIssue[];
  statuses: BoardStatus[];
};

type IssueTypeStatuses = {
  id: string;
  statuses: BoardStatus[];
};

export async function fetchBoard(client: JiraClient): Promise<BoardData> {
  const results = await searchJiraIssuesByJql(
    client,
    "assignee = currentUser() ORDER BY updated DESC",
    { fields: ["summary", "status", "project", "issuetype"] },
  );
  const issues = results.map((item): BoardIssue => {
    const fields = item.fields;
    if (!item.key || !fields?.status?.id || !fields.status.name ||
        !fields.project?.key || !fields.issuetype?.id) {
      throw new Error("Jira returned a ticket without its status or workflow details. Refresh to try again.");
    }
    return {
      issueKey: item.key,
      summary: fields.summary ?? "(no summary)",
      status: { ...fields.status, id: fields.status.id, name: fields.status.name },
      projectKey: fields.project.key,
      issueTypeId: fields.issuetype.id,
    };
  });

  const projects = new Map<string, Set<string>>();
  for (const issue of issues) {
    const types = projects.get(issue.projectKey) ?? new Set<string>();
    types.add(issue.issueTypeId);
    projects.set(issue.projectKey, types);
  }
  const workflows = await Promise.all(
    [...projects].map(async ([projectKey, types]) => {
      const groups = await client.get<IssueTypeStatuses[]>(
        `/rest/api/3/project/${encodeURIComponent(projectKey)}/statuses`,
      );
      return groups.filter((group) => types.has(group.id)).flatMap((group) => group.statuses);
    }),
  );

  // Include empty workflow columns and preserve distinct statuses with the same name.
  const statuses = new Map<string, BoardStatus>();
  for (const status of [...workflows.flat(), ...issues.map((issue) => issue.status)]) {
    if (!status.id || !status.name) throw new Error("Jira returned an invalid workflow status.");
    statuses.set(status.id, status);
  }
  const categoryOrder: Record<string, number> = { new: 0, indeterminate: 1, done: 2 };
  return {
    issues,
    statuses: [...statuses.values()].sort((a, b) =>
      (categoryOrder[a.statusCategory?.key ?? ""] ?? 1) -
      (categoryOrder[b.statusCategory?.key ?? ""] ?? 1) || a.name.localeCompare(b.name),
    ),
  };
}

type Transition = {
  id: string;
  to: BoardStatus;
  isAvailable?: boolean;
  fields?: Record<string, { required?: boolean; hasDefaultValue?: boolean }>;
};

export async function moveBoardIssue(
  client: JiraClient,
  issueKey: string,
  targetStatusId: string,
): Promise<BoardStatus> {
  const key = normalizeIssueKey(issueKey);
  const path = `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`;
  // Re-read available transitions on every move: permissions and workflow can change remotely.
  const body = await client.get<{ transitions: Transition[] }>(path, {
    expand: "transitions.fields",
  });
  const matches = body.transitions.filter((transition) =>
    transition.to?.id === targetStatusId && transition.isAvailable !== false,
  );
  if (matches.length !== 1) {
    throw new Error(matches.length === 0
      ? `${key} cannot move directly to this status. Open it in Jira to follow its workflow.`
      : `${key} has multiple actions for this status. Choose the action in Jira.`);
  }
  const transition = matches[0];
  if (Object.values(transition.fields ?? {}).some((field) => field.required && !field.hasDefaultValue)) {
    throw new Error(`This move requires additional fields. Open ${key} in Jira to complete it.`);
  }
  await client.post(path, { transition: { id: transition.id } });
  return transition.to;
}
