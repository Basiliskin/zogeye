// src/application/rule-registry.ts
import type { Rule, RuleProvider } from "../domain/models.js";
import { networkRules } from "../domain/rules/network-rules.js";
import { staticRules } from "../domain/rules/static-rules.js";
import { dependencyRules } from "../domain/rules/dependency-rules.js";
import {
  graphQlRules,
  graphQlStaticRules,
} from "../domain/rules/graphql-rules.js";
import {
  realtimeRules,
  realtimeStaticRules,
} from "../domain/rules/realtime-rules.js";

export class RuleRegistry implements RuleProvider {
  private readonly rules: Rule[];

  constructor() {
    this.rules = [
      ...networkRules(),
      ...staticRules(),
      ...dependencyRules(),
      ...graphQlRules(),
      ...graphQlStaticRules(),
      ...realtimeRules(),
      ...realtimeStaticRules(),
    ];
  }

  all(): Rule[] {
    return [...this.rules];
  }
}
