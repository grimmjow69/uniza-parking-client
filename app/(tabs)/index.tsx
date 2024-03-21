import * as Location from 'expo-location';
import Colors, { errorColor, successColor } from '@/constants/Colors';
import i18n from '../../assets/localization/i18n';
import MapView, { Circle, Marker } from 'react-native-maps';
import ParkingSheet from '@/components/parking-sheet';
import ParkingSpotHistory from '@/components/parking-spot-history';
import RBSheet from 'react-native-raw-bottom-sheet';
import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import SpinnerOverlay from 'react-native-loading-spinner-overlay';
import { ActivityIndicator, Button, IconButton, Modal, Snackbar, Text, useTheme } from 'react-native-paper';
import { darkMap, LightMap } from '@/constants/map-styles';
import { Dimensions, StyleSheet, View } from 'react-native';
import { fetchAllSpotsData, fetchSpotDetailById, fetchSpotHistory, fetchUserFavouriteSpot,getClosestFreeParkingSpot } from '../services/parking-data-service';
import { format } from 'date-fns';
import { ParkingSheetResponse, ParkingSpot, SpotHistoryRecord } from '../models/parking-spot';
import { PreferencesContext, PreferencesContextProps } from '../context/preference-context';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { subscribeToNotification, unsubscribeFromNotificationByUserAndParkingSpotId } from '../services/notifications-service';
import { UNIZA_INITIAL_REGION } from '@/constants/coords';
import { updateFavouriteSpot } from '../services/user-service';
import { useIsFocused, useNavigation } from '@react-navigation/native';

export interface ModalContent {
  spotName: string;
  history: SpotHistoryRecord[];
}

export interface ParkingSheetContent {
  spotName: string;
  occupied: boolean | null;
  spotId: number;
  sheetData: ParkingSheetResponse;
}

export default function MapScreen() {
  const [parkingSpots, setParkingSpots] = useState<ParkingSpot[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [closestSpot, setClosestSpot] = useState<ParkingSpot | null>(null);
  const [snackbarVisible, setSnackbarVisible] = useState<boolean>(false);
  const [snackbarMessage, setSnackbarMessage] = useState<string>('');
  const [snackbarColor, setSnackbarColor] = useState<string>('');
  const mapRef = useRef<MapView>(null);
  const { isThemeDark, user } =
    useContext<PreferencesContextProps>(PreferencesContext);
  const [isFavourite, setIsFavourite] = useState<boolean>(false);
  const [notificationsEnabled, setNotificationsEnabled] =
    useState<boolean>(false);
  const [modalVisible, setModalVisible] = useState<boolean>(false);
  const [modalContent, setModalContent] = useState<ModalContent | null>(null);
  const [sheetContent, setSheetContent] = useState<ParkingSheetContent | null>(
    null
  );
  const [updatedAt, setUpdatedAt] = useState<string>(i18n.t('base.unknown'));
  const refRBSheet = useRef<RBSheet>(null);

  const navigation = useNavigation();

  const isFocused = useIsFocused();
  const { colors } = useTheme();

  const getData = useCallback(async () => {
    setLoading(true);
    setClosestSpot(null);
    try {
      const allSpotsData = await fetchAllSpotsData();
      setParkingSpots(allSpotsData.data);
      if (allSpotsData.updatedAt) {
        setUpdatedAt(format(allSpotsData.updatedAt, 'HH:mm:ss'));
      } else {
        setUpdatedAt(i18n.t('base.unknown'));
      }
      setSnackBarContent(i18n.t('base.loadSuccess'), successColor);
    } catch (error) {
      setSnackBarContent(i18n.t('base.loadFailed'), errorColor);
    } finally {
      setSnackbarVisible(true);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isFocused) {
      getData();
    }
  }, [isFocused, getData]);

  useEffect(() => {
    const blurListener = navigation.addListener('blur', () => {
      refRBSheet.current?.close();
      setModalVisible(false);
    });

    return blurListener;
  }, [navigation]);

  useEffect(() => {}, [modalContent]);

  function setSnackBarContent(message: string, color: string) {
    setSnackbarColor(color);
    setSnackbarMessage(message);
  }

  const findClosestSpot = useCallback(async () => {
    let { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      setSnackBarContent(i18n.t('base.locationPermissionDenied'), errorColor);
      setSnackbarVisible(true);
      return;
    }

    setLoading(true);

    try {
      let location = await Location.getCurrentPositionAsync({});

      const userLocation = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude
      };

      const closestFreeSpot = await getClosestFreeParkingSpot(
        userLocation.latitude,
        userLocation.longitude
      );

      if (closestFreeSpot) {
        setClosestSpot(closestFreeSpot);
        setSnackBarContent(i18n.t('parkingMap.closestSpotFound'), successColor);
        mapRef.current?.animateToRegion({
          latitude: closestFreeSpot.latitude,
          longitude: closestFreeSpot.longitude,
          latitudeDelta: 0.001,
          longitudeDelta: 0.001
        });
      } else {
        setSnackBarContent(i18n.t('parkingMap.noSpotFound'), errorColor);
      }
    } catch (error) {
      setSnackBarContent(i18n.t('parkingMap.closestSpotFindError'), errorColor);
    } finally {
      setLoading(false);
      setSnackbarVisible(true);
    }
  }, []);

  const findClosestSpotToFav = useCallback(async () => {
    if (user) {
      try {
        setLoading(true);
        const favouriteParkingSpot = await fetchUserFavouriteSpot(user?.userId);
        if (favouriteParkingSpot) {
          const closestFreeSpot = await getClosestFreeParkingSpot(
            favouriteParkingSpot.latitude,
            favouriteParkingSpot.longitude
          );

          if (closestFreeSpot) {
            setClosestSpot(closestFreeSpot);

            setSnackBarContent(
              i18n.t('parkingMap.closestSpotFound'),
              successColor
            );
            mapRef.current?.animateToRegion({
              latitude: closestFreeSpot.latitude,
              longitude: closestFreeSpot.longitude,
              latitudeDelta: 0.001,
              longitudeDelta: 0.001
            });
          } else {
            setSnackBarContent(i18n.t('parkingMap.noSpotFound'), errorColor);
          }
        } else {
          setSnackBarContent(i18n.t('parkingMap.noFavSpot'), errorColor);
        }
      } catch (error) {
        setSnackBarContent(
          i18n.t('parkingMap.closestSpotFindError'),
          errorColor
        );
      } finally {
        setLoading(false);
        setSnackbarVisible(true);
      }
    }
  }, [parkingSpots]);

  const handleMarkerPress = async (
    spotName: string,
    occupied: boolean,
    spotId: number
  ) => {
    try {
      setLoading(true);
      const parkingSpotDetail = await fetchSpotDetailById(
        user ? user.userId : 0,
        spotId
      );

      setSheetContent({
        spotName: spotName,
        occupied: occupied,
        spotId: spotId,
        sheetData: parkingSpotDetail
      });

      setIsFavourite(parkingSpotDetail.isFavourite);
      setNotificationsEnabled(parkingSpotDetail.isNotificationEnabled);

      setLoading(false);
      refRBSheet.current?.open();
    } catch (error) {
    } finally {
      setLoading(false);
    }
  };

  function getMarkerDescription(updatedAt: Date) {
    return `${i18n.t('parkingMap.updatedAt')} ${format(updatedAt, 'HH:mm:ss')}`;
  }

  useEffect(() => {
    if (isFocused) {
      getData();
    }
  }, [isFocused, getData]);

  async function openSpotHistory(spotName: string, spotId: number) {
    try {
      refRBSheet.current?.close();
      setLoading(true);

      const history = await fetchSpotHistory(spotId);

      setModalContent({
        spotName: spotName,
        history: history
      });

      setSnackBarContent(i18n.t('base.loadSuccess'), successColor);
      setModalVisible(true);
    } catch (err) {
      setSnackBarContent(i18n.t('base.loadFailed'), errorColor);
    } finally {
      setLoading(false);
    }
  }

  function getSheetTitle(sheetContent: ParkingSheetContent) {
    var state = '';
    if (sheetContent?.occupied !== null) {
      state = sheetContent?.occupied
        ? i18n.t('parkingMap.parkingSpotDetail.header.stateOccupied')
        : i18n.t('parkingMap.parkingSpotDetail.header.stateFree');
    } else {
      state = i18n.t('parkingMap.parkingSpotDetail.header.stateUnknown');
    }

    return `${sheetContent?.spotName} - ${state}`;
  }

  function getSheetText(sheetContent: ParkingSheetContent) {
    var state = '';
    if (sheetContent?.occupied !== null) {
      state = sheetContent?.occupied
        ? i18n.t('parkingMap.parkingSheet.occupiedSince')
        : i18n.t('parkingMap.parkingSheet.freeSince');
    } else {
      return i18n.t('parkingMap.parkingSheet.stateUnknown');
    }

    var sinceDate = '';

    if (sheetContent.sheetData.stateSince === null) {
      sinceDate = i18n.t('parkingMap.parkingSheet.noData');
    } else {
      sinceDate = format(
        sheetContent.sheetData.stateSince,
        'HH:mm:ss dd.MM.yyyy'
      );
    }

    return `${state}: ${sinceDate}`;
  }

  const renderMarker = (spot: ParkingSpot) => {
    var circleColor = spot.occupied != null ? errorColor : successColor;

    if (spot.occupied != null) {
      circleColor = spot.occupied ? errorColor : successColor;
    } else {
      circleColor = 'gray';
    }

    return (
      <React.Fragment key={spot.parkingSpotId}>
        {closestSpot && (
          <Marker
            key={'closest-overlay'}
            coordinate={{
              latitude: closestSpot.latitude,
              longitude: closestSpot.longitude
            }}
          />
        )}
        <Marker
          key={spot.parkingSpotId}
          opacity={0}
          icon={require('../../assets/images/icon.png')}
          title={spot.name}
          description={getMarkerDescription(spot.updatedAt)}
          coordinate={{
            latitude: spot.latitude,
            longitude: spot.longitude
          }}
          onCalloutPress={() =>
            handleMarkerPress(spot.name, spot.occupied, spot.parkingSpotId)
          }
        />
        <Circle
          center={{
            latitude: spot.latitude,
            longitude: spot.longitude
          }}
          radius={spot.name.startsWith('zaliv') ? 1.1 : 0.75}
          strokeWidth={1}
          strokeColor={circleColor}
          fillColor={circleColor}
        />
      </React.Fragment>
    );
  };

  const onDismissSnackBar = () => setSnackbarVisible(false);

  const handleNotificationPressed = async (userId: number, spotId: number) => {
    try {
      setLoading(true);
      setNotificationsEnabled(!notificationsEnabled);

      if (notificationsEnabled) {
        await unsubscribeFromNotificationByUserAndParkingSpotId(userId, spotId);
        setSnackBarContent(i18n.t('notifications.unsubscribe'), successColor);
      } else {
        await subscribeToNotification(spotId, userId);
        setSnackBarContent(i18n.t('notifications.subscribe'), successColor);
      }
    } catch (error) {
      setSnackBarContent(i18n.t('base.error'), errorColor);
    } finally {
      setSnackbarVisible(true);
      setLoading(false);
    }
  };

  const handleFavouriteSpotPressed = async (userId: number, spotId: number) => {
    try {
      console.log('asddas')
      setIsFavourite(!isFavourite);
      setLoading(true);
      const result = await updateFavouriteSpot(
        userId,
        isFavourite ? null : spotId
      );
      setSnackBarContent(
        result.message,
        result.success ? successColor : errorColor
      );
    } catch (error) {
      setSnackBarContent(i18n.t('base.error'), errorColor);
    } finally {
      setSnackbarVisible(true);
      setLoading(false);
    }
  };

  return (
    <SafeAreaProvider style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={UNIZA_INITIAL_REGION}
        showsUserLocation={true}
        showsCompass={true}
        showsPointsOfInterest={false}
        customMapStyle={isThemeDark ? darkMap : LightMap}
      >
        {loading ? <></> : <>{parkingSpots.map(renderMarker)}</>}
      </MapView>
      <IconButton
        icon="refresh"
        mode="contained"
        iconColor={colors.surfaceVariant}
        containerColor={colors.secondary}
        size={28}
        style={styles.refreshButton}
        onPress={() => getData()}
      />
      <View
        style={[styles.updatedAtTitle, { backgroundColor: colors.secondary }]}
      >
        <Text variant="labelLarge" style={{ color: colors.surfaceVariant }}>
          {i18n.t('parkingMap.updatedAt')} {updatedAt}
        </Text>
      </View>
      <View style={styles.bottomButtons}>
        <Button
          icon="magnify"
          mode="contained"
          buttonColor={colors.secondary}
          labelStyle={{ color: colors.surfaceVariant }}
          onPress={() => findClosestSpot()}
        >
          <Text variant="labelLarge" style={{ color: colors.surfaceVariant }}>
            {i18n.t('parkingMap.findClosestSpot')}
          </Text>
        </Button>
        {user && (
          <Button
            icon="star"
            mode="contained"
            buttonColor={colors.secondary}
            labelStyle={{ color: colors.surfaceVariant }}
            style={styles.findFavParkingSpot}
            onPress={() => findClosestSpotToFav()}
          >
            <Text variant="labelLarge" style={{ color: colors.surfaceVariant }}>
              {i18n.t('parkingMap.findClosestSpot')}
            </Text>
          </Button>
        )}
      </View>
      <Modal
        visible={modalVisible}
        onDismiss={() => setModalVisible(false)}
        contentContainerStyle={[
          styles.modalContainer,
          {
            backgroundColor:
              Colors[isThemeDark ? 'dark' : 'light'].modalContainer
          }
        ]}
      >
        <ParkingSpotHistory
          modalContent={modalContent}
          setModalVisible={setModalVisible}
        />
      </Modal>
      <RBSheet
        ref={refRBSheet}
        closeOnDragDown={true}
        closeOnPressMask={true}
        animationType={'fade'}
        customStyles={{
          wrapper: {
            backgroundColor:
              Colors[isThemeDark ? 'dark' : 'light'].sheetOverlay
          },
          draggableIcon: {
            backgroundColor: Colors[isThemeDark ? 'dark' : 'light'].spinnerColor
          },
          container: {
            backgroundColor:
              Colors[isThemeDark ? 'dark' : 'light'].modalContainer
          }
        }}
      >
        {sheetContent && (
          <ParkingSheet
            getSheetText={getSheetText}
            getSheetTitle={getSheetTitle}
            handleFavouriteSpotPressed={handleFavouriteSpotPressed}
            handleNotificationPressed={handleNotificationPressed}
            isFavourite={isFavourite}
            notificationsEnabled={notificationsEnabled}
            openSpotHistory={openSpotHistory}
            sheetContent={sheetContent}
          />
        )}
      </RBSheet>

      <Snackbar
        visible={snackbarVisible}
        onDismiss={onDismissSnackBar}
        duration={1000}
        style={{ backgroundColor: snackbarColor, alignItems: 'center' }}
      >
        <Text
          style={{ textAlign: 'center', fontWeight: 'bold', color: '#fff' }}
        >
          {' '}
          {snackbarMessage}
        </Text>
      </Snackbar>

      <SpinnerOverlay
        textContent={i18n.t('base.wait')}
        textStyle={isThemeDark ? { color: '#fff' } : { color: '#303c64' }}
        animation="fade"
        visible={loading}
        overlayColor={Colors[isThemeDark ? 'dark' : 'light'].spinnerOverlay}
        customIndicator={
          <ActivityIndicator
            size="large"
            color={Colors[isThemeDark ? 'dark' : 'light'].spinnerColor}
          />
        }
      />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center'
  },
  bottomButtons: {
    position: 'absolute',
    bottom: 8
  },
  refreshButton: {
    position: 'absolute',
    top: 4,
    left: 4
  },
  leftContainer: {
    flex: 1
  },
  rightContainer: {
    flexDirection: 'row'
  },
  modalContainer: {
    height: '100%'
  },
  updatedAtTitle: {
    position: 'absolute',
    top: 10,
    padding: 11,
    borderRadius: 20
  },
  findFavParkingSpot: {
    marginTop: 8
  },
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8
  },
  historyHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8
  },
  historyHeaderColumn: {
    flex: 1,
    paddingHorizontal: 8
  },
  historyColumn: {
    flex: 1,
    paddingHorizontal: 8
  },
  separator: {
    marginVertical: 30,
    height: 1,
    width: '80%'
  },
  map: {
    flex: 1,
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').height
  }
});
