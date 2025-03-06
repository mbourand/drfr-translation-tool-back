export type EnvironmentVariables = {
  // Github
  GITHUB_BASE_URL: string
  GITHUB_APP_CLIENT_ID: string
  GITHUB_APP_CLIENT_SECRET: string
  GITHUB_APP_WEBHOOK_SECRET: string

  // Smee for local development
  ENABLE_SMEE: boolean
  SMEE_BASE_URL: string
  SMEE_GITHUB_WEBHOOK_SOURCE_URL: string
  SMEE_GITHUB_WEBHOOK_TARGET_URL: string
  SMEE_GITHUB_AUTH_CALLBACK_SOURCE_URL: string
  SMEE_GITHUB_AUTH_CALLBACK_TARGET_URL: string
}
