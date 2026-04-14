import { Stack } from 'expo-router';

/**
 * Stack navigator for the Search tab.
 * Mirroring the (home) structure so that the tab bar stays visible
 * when the user drills into a recipe from the search results.
 */
export default function SearchStack() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
