import { type MouseEvent } from "react";
import { openIssueInBrowser } from "../jira/openIssue";
import "./IssueKeyLink.css";

type Props = {
  issueKey: string;
  className?: string;
};

export function IssueKeyLink({ issueKey, className }: Props) {
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    void openIssueInBrowser(issueKey);
  };

  return (
    <button
      type="button"
      className={"issue-key-link" + (className ? ` ${className}` : "")}
      onClick={handleClick}
      title={`Open ${issueKey} in Jira`}
      aria-label={`Open ${issueKey} in Jira`}
    >
      {issueKey}
    </button>
  );
}
