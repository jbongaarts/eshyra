const SANDBOX_ENV_KEY = 'ESHYRA_TEST_SANDBOX';

/**
 * Build the environment inherited by verification child processes.
 *
 * Environment keys are case-insensitive on Windows, so remove every casing of
 * the sandbox marker before optionally adding one canonical key for explicit
 * restricted-sandbox verification.
 */
export function buildVerificationEnvironment(environment, sandboxMode) {
  const childEnv = Object.fromEntries(
    Object.entries(environment).filter(
      ([key]) => key.toUpperCase() !== SANDBOX_ENV_KEY,
    ),
  );
  if (sandboxMode) {
    childEnv[SANDBOX_ENV_KEY] = '1';
  }
  return childEnv;
}
