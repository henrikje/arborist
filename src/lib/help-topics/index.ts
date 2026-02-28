import { remotesTopic } from "./remotes";
import { scriptingTopic } from "./scripting";
import { stackedTopic } from "./stacked";
import { templatesTopic } from "./templates";
import { whereFilterTopic } from "./where";

export interface HelpTopic {
	name: string;
	summary: string;
	render(): void;
}

const TOPICS: HelpTopic[] = [whereFilterTopic, remotesTopic, stackedTopic, templatesTopic, scriptingTopic];

export function findTopic(name: string): HelpTopic | undefined {
	return TOPICS.find((t) => t.name === name);
}

export function allTopics(): HelpTopic[] {
	return TOPICS;
}
