/**
 * Integration schema system for extensible adapter configuration.
 *
 * Extends the base {@link AdapterConfigField} with richer field definitions
 * that support dynamic UI generation: input types, validation rules,
 * help text, documentation links, and select options.
 *
 * The schema system is additive — every {@link IntegrationFieldSchema}
 * is a valid {@link AdapterConfigField}, maintaining backward compatibility
 * with existing adapter registration and validation.
 *
 * @module store/integration-schema
 */

import type { AdapterConfigField } from "./adapter-registry.js";

// ---------------------------------------------------------------------------
// Field input types
// ---------------------------------------------------------------------------

/**
 * Supported input types for integration configuration fields.
 *
 * Maps directly to HTML input types plus `select` and `textarea`.
 */
export type FieldInputType =
  | "text"
  | "password"
  | "url"
  | "email"
  | "number"
  | "checkbox"
  | "select"
  | "textarea";

// ---------------------------------------------------------------------------
// Validation rules
// ---------------------------------------------------------------------------

/**
 * Validation rule for a configuration field.
 *
 * Rules are evaluated in order. The first failing rule produces
 * the error message shown to the user.
 */
export interface FieldValidationRule {
  /** Rule type. */
  type: "pattern" | "minLength" | "maxLength" | "min" | "max" | "custom";

  /**
   * Regex pattern string (for `type: "pattern"`).
   * Evaluated with `new RegExp(pattern)`.
   */
  pattern?: string;

  /** Minimum string length (for `type: "minLength"`). */
  minLength?: number;

  /** Maximum string length (for `type: "maxLength"`). */
  maxLength?: number;

  /** Minimum numeric value (for `type: "min"`). */
  min?: number;

  /** Maximum numeric value (for `type: "max"`). */
  max?: number;

  /**
   * Custom validator function name.
   *
   * For `type: "custom"`, this names a well-known validator that the
   * UI can resolve. Examples: `"notionApiKey"`, `"notionDatabaseId"`.
   * The server validates these server-side; the client can also run them
   * for immediate feedback.
   */
  validator?: string;

  /** Error message shown when this rule fails. */
  message: string;
}

// ---------------------------------------------------------------------------
// Select option
// ---------------------------------------------------------------------------

/** A single option for `select` input type fields. */
export interface FieldSelectOption {
  /** Display label. */
  label: string;
  /** Stored value. */
  value: string;
  /** Optional description shown as help text for this option. */
  description?: string;
}

// ---------------------------------------------------------------------------
// Integration field schema
// ---------------------------------------------------------------------------

/**
 * Rich field schema for integration configuration.
 *
 * Extends {@link AdapterConfigField} with UI-generation metadata.
 * Every `IntegrationFieldSchema` satisfies the `AdapterConfigField`
 * contract, so existing adapter registration code works unchanged.
 */
export interface IntegrationFieldSchema extends AdapterConfigField {
  /** Display label for the field (defaults to the field key if omitted). */
  label?: string;

  /** Input type for UI rendering. Defaults to `"text"`. */
  inputType?: FieldInputType;

  /** Placeholder text shown in the input. */
  placeholder?: string;

  /** Extended help text shown below the input. */
  helpText?: string;

  /**
   * URL to documentation for this field.
   * Rendered as a clickable link in the help text area.
   */
  docUrl?: string;

  /** Label for the documentation link. Defaults to `"Learn more"`. */
  docLabel?: string;

  /** Default value for the field. */
  defaultValue?: string | number | boolean;

  /**
   * Validation rules evaluated in order.
   * The first failing rule produces the error message.
   */
  validationRules?: FieldValidationRule[];

  /** Options for `select` input type. */
  options?: FieldSelectOption[];

  /**
   * Display group for organizing fields in the UI.
   * Fields with the same group are rendered together under a heading.
   */
  group?: string;

  /**
   * Display order within the group (lower = earlier).
   * Fields without an explicit order are appended at the end.
   */
  order?: number;
}

// ---------------------------------------------------------------------------
// Integration schema
// ---------------------------------------------------------------------------

/**
 * Complete schema for an integration type.
 *
 * Defines the metadata, fields, and UI hints for a specific integration
 * (e.g., Notion, Jira, Linear). The schema drives both server-side
 * validation and client-side form generation.
 */
export interface IntegrationSchema {
  /** Integration identifier (matches the adapter name). */
  id: string;

  /** Display name for the integration. */
  name: string;

  /** Short description shown in the integration list. */
  description: string;

  /** Icon identifier or emoji for the integration. */
  icon?: string;

  /** URL to the integration's homepage or documentation. */
  docsUrl?: string;

  /**
   * Setup guide steps shown in the UI.
   * Each string is one step (supports basic markdown-like formatting).
   */
  setupGuide?: string[];

  /** Field schemas keyed by field name. */
  fields: Record<string, IntegrationFieldSchema>;

  /**
   * Groups for organizing fields in the UI.
   * Keys are group identifiers matching `IntegrationFieldSchema.group`.
   */
  groups?: Record<string, IntegrationFieldGroup>;

  /**
   * Whether this integration supports connection testing.
   * When `true`, the UI shows a "Test Connection" button.
   */
  supportsConnectionTest?: boolean;

  /**
   * Whether this integration supports schema validation
   * (like Notion's database property checks).
   */
  supportsSchemaValidation?: boolean;

  /** Whether this is a built-in integration (vs. user-registered). */
  builtIn?: boolean;
}

/**
 * A group of fields in the integration configuration UI.
 */
export interface IntegrationFieldGroup {
  /** Display label for the group. */
  label: string;

  /** Optional icon or emoji. */
  icon?: string;

  /** Display order (lower = earlier). */
  order?: number;

  /** Optional description shown below the group heading. */
  description?: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Result of validating a single field value. */
export interface FieldValidationResult {
  /** Whether the field value is valid. */
  valid: boolean;
  /** Error message if invalid. */
  error?: string;
}

/**
 * Validate a field value against its schema's validation rules.
 *
 * Returns the first failing rule's error message, or `{ valid: true }`
 * if all rules pass.
 */
export function validateField(
  value: unknown,
  schema: IntegrationFieldSchema,
): FieldValidationResult {
  // Required check
  if (schema.required) {
    if (value === undefined || value === null || value === "") {
      return { valid: false, error: `${schema.label ?? "This field"} is required` };
    }
  }

  // Skip further validation for empty optional fields
  if (value === undefined || value === null || value === "") {
    return { valid: true };
  }

  const strValue = String(value);

  if (!schema.validationRules) return { valid: true };

  for (const rule of schema.validationRules) {
    switch (rule.type) {
      case "pattern":
        if (rule.pattern && !new RegExp(rule.pattern).test(strValue)) {
          return { valid: false, error: rule.message };
        }
        break;

      case "minLength":
        if (rule.minLength !== undefined && strValue.length < rule.minLength) {
          return { valid: false, error: rule.message };
        }
        break;

      case "maxLength":
        if (rule.maxLength !== undefined && strValue.length > rule.maxLength) {
          return { valid: false, error: rule.message };
        }
        break;

      case "min":
        if (rule.min !== undefined && Number(value) < rule.min) {
          return { valid: false, error: rule.message };
        }
        break;

      case "max":
        if (rule.max !== undefined && Number(value) > rule.max) {
          return { valid: false, error: rule.message };
        }
        break;

      case "custom":
        // Custom validators are resolved at runtime by the consumer.
        // Server-side and client-side validators are registered separately.
        break;
    }
  }

  return { valid: true };
}

/**
 * Validate all fields in a config against an integration schema.
 *
 * @returns Map of field name to validation result (only invalid fields included).
 */
export function validateConfig(
  config: Record<string, unknown>,
  schema: IntegrationSchema,
): Record<string, FieldValidationResult> {
  const errors: Record<string, FieldValidationResult> = {};

  for (const [fieldName, fieldSchema] of Object.entries(schema.fields)) {
    const result = validateField(config[fieldName], fieldSchema);
    if (!result.valid) {
      errors[fieldName] = result;
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Schema registry
// ---------------------------------------------------------------------------

/** Registry of integration schemas, keyed by integration ID. */
const schemas = new Map<string, IntegrationSchema>();

/**
 * Register an integration schema.
 *
 * @throws If a schema with the same ID is already registered.
 */
export function registerIntegrationSchema(schema: IntegrationSchema): void {
  if (schemas.has(schema.id)) {
    throw new Error(`Integration schema "${schema.id}" is already registered`);
  }
  schemas.set(schema.id, schema);
}

/** Get a registered integration schema by ID. */
export function getIntegrationSchema(id: string): IntegrationSchema | undefined {
  return schemas.get(id);
}

/** List all registered integration schemas. */
export function listIntegrationSchemas(): IntegrationSchema[] {
  return Array.from(schemas.values());
}

/**
 * Reset the schema registry (for testing only).
 * @internal
 */
export function resetIntegrationSchemas(): void {
  schemas.clear();
}

// ---------------------------------------------------------------------------
// Utility: convert IntegrationSchema fields to AdapterConfigField map
// ---------------------------------------------------------------------------

/**
 * Extract the base {@link AdapterConfigField} map from an integration schema.
 *
 * This allows an `IntegrationSchema` to be used anywhere an
 * `AdapterDefinition.configSchema` is expected, preserving backward
 * compatibility.
 */
export function toAdapterConfigSchema(
  schema: IntegrationSchema,
): Record<string, AdapterConfigField> {
  const result: Record<string, AdapterConfigField> = {};
  for (const [key, field] of Object.entries(schema.fields)) {
    result[key] = {
      required: field.required,
      description: field.description,
      sensitive: field.sensitive,
    };
  }
  return result;
}
