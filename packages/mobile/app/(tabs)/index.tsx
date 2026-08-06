import { View, StyleSheet } from 'react-native';
import DiscoverTabs from '../../components/DiscoverTabs';
import { colors } from '../../theme/tokens';

export default function DiscoverPage() {
  return (
    <View style={styles.container}>
      <DiscoverTabs />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
});
