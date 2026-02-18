/**
 * Notion integration schema definition.
 *
 * Migrates the existing Notion adapter config to the new integration
 * schema system. The field definitions encode the same validation rules
 * previously hardcoded in `routes-notion.ts` and `notion-config.ts`.
 *
 * @module store/integration-schemas/notion
 */

import type { IntegrationSchema } from "../integration-schema.js";

export const notionIntegrationSchema: IntegrationSchema = {
  id: "notion",
  name: "Notion",
  description: "Connect your PRD to a Notion database for two-way sync.",
  icon: "\u{1F50C}",
  docsUrl: "https://developers.notion.com/docs/getting-started",
  supportsConnectionTest: true,
  supportsSchemaValidation: true,
  builtIn: true,

  groups: {
    credentials: {
      label: "Credentials",
      icon: "\u{1F511}",
      order: 0,
      description: "API key and database identifier for Notion.",
    },
  },

  setupGuide: [
    "Create an integration at [notion.so/my-integrations](https://www.notion.so/my-integrations) and copy the token.",
    "Create or select a database in your Notion workspace for storing PRD items.",
    "Share the database with your integration (click \u2022\u2022\u2022 in the database, then Connections).",
    "Copy the database ID from the URL and paste it above.",
    "Test the connection to verify everything works.",
  ],

  fields: {
    token: {
      required: true,
      sensitive: true,
      description: "Notion integration token (secret_xxx or ntn_xxx)",
      label: "Notion API Key",
      inputType: "password",
      placeholder: "secret_xxxxx or ntn_xxxxx",
      helpText: "Integration token from your Notion workspace.",
      docUrl: "https://www.notion.so/my-integrations",
      docLabel: "notion.so/my-integrations",
      group: "credentials",
      order: 0,
      validationRules: [
        {
          type: "pattern",
          pattern: "^(secret_|ntn_)",
          message: "API key must start with 'secret_' or 'ntn_'",
        },
        {
          type: "minLength",
          minLength: 20,
          message: "API key appears too short",
        },
      ],
    },
    databaseId: {
      required: true,
      sensitive: false,
      description: "Notion database ID",
      label: "Database ID",
      inputType: "text",
      placeholder: "e.g. a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
      helpText: "The UUID of your Notion database. Find it in the database URL: notion.so/{workspace}/{database_id}?v=...",
      group: "credentials",
      order: 1,
      validationRules: [
        {
          type: "pattern",
          pattern: "^[0-9a-fA-F-]{32,36}$",
          message: "Database ID must be a valid UUID (32 hex characters, with or without hyphens)",
        },
      ],
    },
  },
};
