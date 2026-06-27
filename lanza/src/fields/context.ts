import type { InjectionKey } from "vue";
import type { GitHubClient } from "../backend/github";

// The relation widget needs the GitHub client to list a target collection's
// entries. Provided once at the form root so deeply-nested fields can reach it.
export const CLIENT_KEY: InjectionKey<GitHubClient> = Symbol("lanza:client");
