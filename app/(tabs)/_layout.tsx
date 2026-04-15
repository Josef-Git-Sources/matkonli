import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/colors';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface TabConfig {
  name: string;
  title: string;
  icon: IoniconName;
  iconFocused: IoniconName;
  /** Explicit href so pressing the tab always navigates to this route (resets the stack). */
  href?: string;
}

const TABS: TabConfig[] = [
  // (home) is a route group that contains a nested Stack (home screen + recipe detail).
  // href: '/' ensures pressing the Home tab always pops back to the recipe list even
  // when the stack is deep inside a recipe detail screen.
  { name: '(home)',   title: 'בית',        icon: 'home-outline',     iconFocused: 'home',  href: '/' },
  { name: '(search)', title: 'חיפוש',      icon: 'search-outline',   iconFocused: 'search' },
  { name: 'add',      title: 'הוסף מתכון', icon: 'add-circle-outline', iconFocused: 'add-circle' },
  { name: 'shopping', title: 'קניות',      icon: 'cart-outline',     iconFocused: 'cart' },
  { name: 'profile',  title: 'פרופיל',     icon: 'person-outline',   iconFocused: 'person' },
];

export default function TabsLayout() {
  return (
    <Tabs
      sceneContainerStyle={{ backgroundColor: 'transparent' }}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.tabBarActive,
        tabBarInactiveTintColor: Colors.tabBarInactive,
        tabBarStyle: {
          backgroundColor: Colors.tabBar,
          borderTopColor: Colors.border,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '500',
        },
      }}
    >
      {TABS.map(({ name, title, icon, iconFocused, href }) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title,
            ...(href !== undefined ? { href } : {}),
            tabBarIcon: ({ focused, color, size }) => (
              <Ionicons
                name={focused ? iconFocused : icon}
                size={size}
                color={color}
              />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
