import { Stack } from 'expo-router';

/**
 * Stack navigator for the Home tab.
 * Declaring screens explicitly keeps the initial route unambiguous and
 * ensures that tapping the Home tab icon while inside a recipe correctly
 * pops back to the list (React Navigation's default "pop-to-top on active
 * tab press" behaviour works reliably when the stack is fully declared).
 */
export default function HomeStack() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="recipe/[id]" />
    </Stack>
  );
}
