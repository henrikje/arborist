import { remotesTopic } from "./remotes";
import { scriptingTopic } from "./scripting";
import { stackedTopic } from "./stacked";
import { templatesTopic } from "./templates";

export type { HelpTopic } from "./types";

import type { HelpTopic } from "./types";
import { whereFilterTopic } from "./where";

const TOPICS: HelpTopic[] = [whereFilterTopic, remotesTopic, stackedTopic, templatesTopic, scriptingTopic];

export function findTopic(name: string): HelpTopic | undefined {
  return TOPICS.find((t) => t.name === name);
}

export function allTopics(): HelpTopic[] {
  return TOPICS;
}
