import { Animated, Pressable, Text, View, type PressableProps, type ViewProps } from "react-native";
import { useRef, useEffect } from "react";

export function Screen({ className = "", ...props }: ViewProps & { className?: string }) {
  return <View className={`flex-1 bg-zinc-100 px-5 py-5 ${className}`.trim()} {...props} />;
}

export function Card({ className = "", ...props }: ViewProps & { className?: string }) {
  return <View className={`rounded-3xl border border-zinc-200 bg-zinc-50 p-4 ${className}`.trim()} {...props} />;
}

function SegmentedPill({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  const bg = useRef(new Animated.Value(active ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(bg, { toValue: active ? 1 : 0, duration: 200, useNativeDriver: false }).start();
  }, [active, bg]);

  const backgroundColor = bg.interpolate({
    inputRange: [0, 1],
    outputRange: ["transparent", "#18181b"]
  });
  const textColor = bg.interpolate({
    inputRange: [0, 1],
    outputRange: ["#71717a", "#fafafa"]
  });

  return (
    <Pressable onPress={onPress} className="flex-1" style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
      <Animated.View className="rounded-lg px-3 py-2.5" style={{ backgroundColor }}>
        <Animated.Text className="text-center text-sm font-medium" style={{ color: textColor }}>
          {label}
        </Animated.Text>
      </Animated.View>
    </Pressable>
  );
}

export function SegmentedControl({
  value,
  options,
  onChange
}: {
  value: string;
  options: Array<{ label: string; value: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <View className="mb-5 flex-row rounded-xl border border-zinc-200 bg-zinc-100 p-1">
      {options.map((option) => (
        <SegmentedPill
          key={option.value}
          active={option.value === value}
          label={option.label}
          onPress={() => onChange(option.value)}
        />
      ))}
    </View>
  );
}

export function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View className="mb-5">
      <Text className="text-4xl font-bold tracking-tight text-zinc-900">{title}</Text>
      {subtitle ? <Text className="mt-1 text-sm text-zinc-500">{subtitle}</Text> : null}
    </View>
  );
}

export function PrimaryButton({
  label,
  disabled,
  className = "",
  ...props
}: PressableProps & { label: string; className?: string }) {
  return (
    <Pressable
      disabled={disabled}
      className={`rounded-2xl px-4 py-4 ${disabled ? "bg-zinc-400" : "bg-zinc-900"} ${className}`.trim()}
      {...props}
    >
      <Text className="text-center text-base font-semibold text-zinc-50">{label}</Text>
    </Pressable>
  );
}

export function SecondaryButton({
  label,
  className = "",
  ...props
}: PressableProps & { label: string; className?: string }) {
  return (
    <Pressable className={`rounded-2xl border border-zinc-300 bg-zinc-50 px-4 py-3 ${className}`.trim()} {...props}>
      <Text className="text-center text-sm font-semibold text-zinc-700">{label}</Text>
    </Pressable>
  );
}
