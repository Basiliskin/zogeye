// dependency-cruiser architecture rules for installed projects.
// Source of truth: deterministic-plan.md section 10. Adjust the path
// regexes below to match each project's actual folder layout if needed.
export default {
  forbidden: [
    {
      name: "no-circular",
      comment: "Circular dependencies are forbidden.",
      severity: "error",
      from: {},
      to: {
        circular: true,
      },
    },
    {
      name: "frontend-not-to-backend",
      comment: "Frontend code must not import backend code.",
      severity: "error",
      from: {
        path: "^(src/frontend|src/app|src/components|src/pages|src/ui)",
      },
      to: {
        path: "^(src/backend|src/server|src/api-server|src/modules)",
      },
    },
    {
      name: "backend-not-to-frontend",
      comment: "Backend code must not import frontend code.",
      severity: "error",
      from: {
        path: "^(src/backend|src/server|src/api-server|src/modules)",
      },
      to: {
        path: "^(src/frontend|src/components|src/pages|src/ui)",
      },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: "tsconfig.json",
    },
  },
};
