/** Renders the small Markdown subset used by the legal pages. */
import * as WebBrowser from 'expo-web-browser';
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { FontSize, Spacing } from '@/constants/Spacing';
import { Radius } from '@/constants/theme';
import { tokenizeMarkdown, type Span } from '@/services/markdown';

export default function Markdown({ source, skipTitle = false }: { source: string; skipTitle?: boolean }) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const styles = useMemo(() => createStyles(colors), [colors]);
  const blocks = useMemo(() => {
    const all = tokenizeMarkdown(source);
    return skipTitle && all[0]?.type === 'h1' ? all.slice(1) : all;
  }, [source, skipTitle]);

  const spans = (list: Span[]) =>
    list.map((s, i) => (
      <Text
        key={i}
        style={[s.bold && styles.bold, s.italic && styles.italic, s.href && styles.link]}
        onPress={s.href ? () => void WebBrowser.openBrowserAsync(s.href!) : undefined}
        accessibilityRole={s.href ? 'link' : undefined}
      >
        {s.text}
      </Text>
    ));

  return (
    <View style={{ gap: Spacing.md }}>
      {blocks.map((b, i) => {
        switch (b.type) {
          case 'h1':
          case 'h2':
          case 'h3':
            return (
              <Text key={i} style={styles[b.type]} accessibilityRole="header">
                {spans(b.spans)}
              </Text>
            );
          case 'p':
            return (
              <Text key={i} style={styles.p} selectable>
                {spans(b.spans)}
              </Text>
            );
          case 'list':
            return (
              <View key={i} style={{ gap: 6 }}>
                {b.items.map((item, j) => (
                  <View key={j} style={styles.li}>
                    <View style={styles.bullet} />
                    <Text style={[styles.p, { flex: 1 }]}>{spans(item)}</Text>
                  </View>
                ))}
              </View>
            );
          case 'table':
            return (
              <View key={i} style={styles.table}>
                {b.rows.map((row, r) => (
                  <View key={r} style={[styles.tr, r === 0 && styles.thead, r > 0 && styles.trBorder]}>
                    {row.map((cell, c) => (
                      <Text key={c} style={[styles.td, r === 0 && styles.th, c === 0 && { flex: 1.3 }]}>
                        {cell}
                      </Text>
                    ))}
                  </View>
                ))}
              </View>
            );
        }
      })}
    </View>
  );
}

function createStyles(colors: typeof Colors.light) {
  return StyleSheet.create({
    h1: { fontSize: FontSize.xl, fontWeight: '800', color: colors.text },
    h2: { fontSize: FontSize.lg - 2, fontWeight: '800', color: colors.text, marginTop: Spacing.sm },
    h3: { fontSize: FontSize.md, fontWeight: '700', color: colors.text },
    p: { fontSize: FontSize.md - 1, lineHeight: 23, color: colors.text },
    bold: { fontWeight: '700' },
    italic: { fontStyle: 'italic' },
    link: { color: colors.tint, textDecorationLine: 'underline' },
    li: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
    bullet: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.tint, marginTop: 9 },
    table: { borderRadius: Radius.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
    tr: { flexDirection: 'row' },
    thead: { backgroundColor: colors.surface },
    trBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    td: { flex: 1, padding: Spacing.sm, fontSize: FontSize.xs + 1, color: colors.text, lineHeight: 18 },
    th: { fontWeight: '800', color: colors.textMuted },
  });
}
