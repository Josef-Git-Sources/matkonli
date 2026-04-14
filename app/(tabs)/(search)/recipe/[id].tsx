// Shares the recipe detail screen with the (home) stack.
// Both stacks need their own route file so Expo Router can push within
// the correct navigator, but the actual component lives in one place.
export { default } from '../../(home)/recipe/[id]';
