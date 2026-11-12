/**
 * Grouped settings rows in the iOS inset-grouped style.
 */
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { FontSize, Spacing } from '@/constants/Spacing';
import { Radius } from '@/constants/theme';
import { haptic } from '@/services/haptics';

import AnimatedPressable from './AnimatedPressable';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

export function SettingsSection({ title, footer, children }: { title?: string; footer?: string; children: React.ReactNode }) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const rows = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={styles.section}>
      {title && <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>{title}</Text>}
      <View style={[styles.group, { backgroundColor: colors.card }]}>
        {rows.map((row, i) => (
          <View key={i}>
            {i > 0 && <View style={[styles.separator, { backgroundColor: colors.border }]} />}
            {row}
          </View>
        ))}
      </View>
      {footer && <Text style={[styles.footer, { color: colors.textMuted }]}>{footer}</Text>}
    </View>
  );
}

export function SettingsRow({
  icon,
  iconColor,
  label,
  value,
  onPress,
  destructive,
  badge,
  toggle,
  chevron = true,
}: {
  icon: IconName;
  iconColor?: string;
  label: string;
  value?: string;
  onPress?: () => void;
  destructive?: boolean;
  badge?: string;
  toggle?: { value: boolean; onChange: (value: boolean) => void };
  chevron?: boolean;
}) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const tint = destructive ? colors.danger : iconColor ?? colors.tint;

  const body = (
    <View style={styles.row}>
      <View style={[styles.iconWrap, { backgroundColor: `${tint}1F` }]}>
        <Ionicons name={icon} size={17} color={tint} />
      </View>
      <Text style={[styles.label, { color: destructive ? colors.danger : colors.text }]} numberOfLines={1}>
        {label}
      </Text>
      {badge && <Text style={[styles.badge, { color: colors.tint, borderColor: colors.tint }]}>{badge}</Text>}
      {value && (
        <Text style={[styles.value, { color: colors.textMuted }]} numberOfLines={1}>
          {value}
        </Text>
      )}
      {toggle ? (
        <Switch
          value={toggle.value}
          onValueChange={(next) => {
            void haptic('selection');
            toggle.onChange(next);
          }}
          trackColor={{ true: colors.tint, false: colors.border }}
          accessibilityLabel={label}
        />
      ) : (
        onPress && chevron && <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      )}
    </View>
  );

  if (!onPress || toggle) return body;
  return (
    <AnimatedPressable haptic="selection" scaleTo={0.98} onPress={onPress} accessibilityRole="button">
      {body}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: Spacing.xl },
  sectionTitle: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: Spacing.sm,
    marginLeft: Spacing.sm,
  },
  group: { borderRadius: Radius.lg, overflow: 'hidden' },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 56 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.md, minHeight: 52 },
  iconWrap: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  label: { flex: 1, fontSize: FontSize.md, fontWeight: '500' },
  value: { fontSize: FontSize.sm, maxWidth: 160 },
  badge: { fontSize: 10, fontWeight: '800', borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  footer: { fontSize: FontSize.xs, marginTop: Spacing.sm, marginHorizontal: Spacing.sm, lineHeight: 17 },
});
