import { Stack } from 'expo-router';

/**
 * Stack navigator for the Home tab.
 * Wrapping the home screen and recipe detail in a Stack keeps the bottom
 * tab bar visible when the user drills into a recipe — the tab bar is owned
 * by the parent Tabs navigator and stays mounted throughout.
 */
export default function HomeStack() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
