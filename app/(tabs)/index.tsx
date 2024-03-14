import * as Location from 'expo-location';
import Colors, { errorColor, successColor } from '@/constants/colors';
import i18n from '../../assets/localization/i18n';
import MapView, { Circle, Marker } from 'react-native-maps';
import moment from 'moment';
import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import SpinnerOverlay from 'react-native-loading-spinner-overlay';
import { ActivityIndicator, Button, Divider, IconButton, Modal, Snackbar, Text } from 'react-native-paper';
import { darkMap, LightMap } from '@/constants/map-styles';
import { Dimensions, ScrollView, StyleSheet, View } from 'react-native';
import {
  fetchAllSpotsData,
  fetchSpotDetailById,
  fetchUserFavouriteSpot,
  getClosestFreeParkingSpot
} from '../services/parking-data-service';
import { ParkingSpot, ParkingSpotDetail } from '../models/parking-spot';
import { PreferencesContext } from '../context/preference-context';
import {
  subscribeToNotification,
  unsubscribeFromNotificationByUserAndParkingSpotId
} from '../services/notifications-service';
import { UNIZA_INITIAL_REGION } from '@/constants/coords';
import { updateFavouriteSpot } from '../services/user-service';
import { useIsFocused } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

export interface ModalContent {
  spotName: string;
  occupied: boolean | null;
  spotId: number;
  detail: ParkingSpotDetail | null;
}

export default function MapScreen() {
  const [parkingSpots, setParkingSpots] = useState<ParkingSpot[]>([]);
  const [loading, setLoading] = useState(false);
  const [closestSpot, setClosestSpot] = useState<ParkingSpot | null>(null);
  const [snackbarVisible, setSnackbarVisible] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');
  const [snackbarColor, setSnackbarColor] = useState('#323232');
  const mapRef = useRef<MapView>(null);
  const { isThemeDark, user } = useContext(PreferencesContext);
  const [isFavourite, setIsFavourite] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [modalContent, setModalContent] = useState<ModalContent | null>(null);

  const isFocused = useIsFocused();

  const getData = useCallback(async () => {
    setLoading(true);
    setClosestSpot(null);
    try {
      const allSpotsData = await fetchAllSpotsData();
      setParkingSpots(allSpotsData);
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

      const closestFreeSpot = await getClosestFreeParkingSpot(userLocation.latitude, userLocation.longitude);

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
        } else {
          setSnackBarContent(i18n.t('parkingMap.noFavSpot'), errorColor);
        }
      } catch (error) {
        setSnackBarContent(i18n.t('parkingMap.closestSpotFindError'), errorColor);
      } finally {
        setLoading(false);
        setSnackbarVisible(true);
      }
    }
  }, [parkingSpots]);

  const handleMarkerPress = async (spotName: string, occupied: boolean, spotId: number) => {
    try {
      setLoading(true);
      const parkingSpotDetail = await fetchSpotDetailById(user ? user.userId : 0, spotId);
      setModalContent({
        spotName: spotName,
        occupied: occupied,
        spotId: spotId,
        detail: parkingSpotDetail
      });

      setIsFavourite(parkingSpotDetail.isFavourite);
      setNotificationsEnabled(parkingSpotDetail.isNotificationEnabled);

      setModalVisible(true);
    } catch (error) {
      console.error('Failed to fetch parking spot details:', error);
    } finally {
      setLoading(false);
    }
  };

  function getMarkerDescription(updatedAt: Date) {
    return `${i18n.t('parkingMap.updatedAt')} ${moment(updatedAt).format('HH:mm:ss')}`;
  }

  function getParkingSpotModalState(modalContent: ModalContent) {
    var state = '';

    if (modalContent?.occupied !== null) {
      state = modalContent?.occupied
        ? i18n.t('parkingMap.parkingSpotDetail.header.stateOccupied')
        : i18n.t('parkingMap.parkingSpotDetail.header.stateFree');
    } else {
      state = i18n.t('parkingMap.parkingSpotDetail.header.stateUnknown');
    }

    return `${modalContent?.spotName} - ${state}`;
  }

  const renderMarker = (spot: ParkingSpot) => {
    const isClosestSpot = spot === closestSpot;
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
          onCalloutPress={() => handleMarkerPress(spot.name, spot.occupied, spot.parkingSpotId)}
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
      setIsFavourite(!isFavourite);
      setLoading(true);
      await updateFavouriteSpot(userId, isFavourite ? null : spotId);
      setSnackBarContent(i18n.t('parkingMap.favourite.updated'), successColor);
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
        iconColor={Colors[isThemeDark ? 'dark' : 'light'].refreshIconText}
        containerColor={Colors[isThemeDark ? 'dark' : 'light'].refreshIcon}
        size={30}
        style={styles.refreshButton}
        onPress={() => getData()}
      />
      <View style={styles.bottomButtons}>
        <Button icon="magnify" mode="contained" onPress={() => findClosestSpot()}>
          {i18n.t('parkingMap.findClosestSpot')}
        </Button>
        {user?.favouriteSpotId && (
          <Button icon="star" mode="contained" style={styles.findFavParkingSpot} onPress={() => findClosestSpotToFav()}>
            {i18n.t('parkingMap.findClosestSpot')}
          </Button>
        )}
      </View>
      <Modal
        visible={modalVisible}
        onDismiss={() => setModalVisible(false)}
        contentContainerStyle={[
          styles.modalContainer,
          { backgroundColor: Colors[isThemeDark ? 'dark' : 'light'].modalContainer }
        ]}
      >
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>{getParkingSpotModalState(modalContent!)}</Text>
          {user && (
            <View style={styles.modalActionIcons}>
              <IconButton
                icon={notificationsEnabled ? 'bell' : 'bell-outline'}
                // iconColor={modalContent?.detail?.isNotificationEnabled ? 'blue' : 'black'}
                size={30}
                onPress={() => handleNotificationPressed(user!.userId, modalContent!.spotId)}
              />
              <IconButton
                icon={isFavourite ? 'star' : 'star-outline'}
                // iconColor={modalContent?.detail?.isFavourite ? 'blue' : 'black'}
                size={30}
                onPress={() => handleFavouriteSpotPressed(user!.userId, modalContent!.spotId)}
              />
            </View>
          )}
        </View>
        <Divider />
        <ScrollView style={styles.modalScrollContent}>
          <View
            style={[
              styles.historyHeaderRow,
              { backgroundColor: Colors[isThemeDark ? 'dark' : 'light'].modalContainerTableHeader }
            ]}
          >
            <View style={styles.historyHeaderColumn}>
              <Text style={styles.historyHeaderText}>
                {i18n.t('parkingMap.parkingSpotDetail.table.stateColumnName')}
              </Text>
            </View>
            <View style={styles.historyHeaderColumn}>
              <Text style={styles.historyHeaderText}>
                {i18n.t('parkingMap.parkingSpotDetail.table.updatedAtColumnName')}
              </Text>
            </View>
          </View>
          {modalContent?.detail?.history?.map((historyItem, index) => (
            <View key={index} style={styles.historyRow}>
              <View style={styles.historyColumn}>
                <Text style={styles.historyText}>
                  {historyItem.occupied
                    ? i18n.t('parkingMap.parkingSpotDetail.table.stateOccupied')
                    : i18n.t('parkingMap.parkingSpotDetail.table.stateFree')}
                </Text>
              </View>
              <View style={styles.historyColumn}>
                <Text style={styles.historyText}>{moment(historyItem.updatedAt).format('HH:mm:ss DD.MM.YYYY')}</Text>
              </View>
              <Divider />
            </View>
          ))}
        </ScrollView>
        <View style={styles.modalFooter}>
          <Button mode="contained" style={styles.closeModalButton} onPress={() => setModalVisible(false)}>
            {i18n.t('base.close')}
          </Button>
        </View>
      </Modal>
      <Snackbar
        visible={snackbarVisible}
        onDismiss={onDismissSnackBar}
        duration={1000}
        style={{ backgroundColor: snackbarColor, alignItems: 'center' }}
      >
        <Text style={{ textAlign: 'center', fontWeight: 'bold', color: '#fff' }}> {snackbarMessage}</Text>
      </Snackbar>
      <SpinnerOverlay
        textContent={i18n.t('base.wait')}
        textStyle={isThemeDark ? { color: '#fff' } : { color: '#303c64' }}
        animation="fade"
        visible={loading}
        overlayColor={Colors[isThemeDark ? 'dark' : 'light'].spinnerOverlay}
        customIndicator={<ActivityIndicator size="large" color={Colors[isThemeDark ? 'dark' : 'light'].spinnerColor} />}
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
    top: 8,
    left: 8
  },
  modalContainer: {
    padding: 20,
    margin: 20,
    height: Dimensions.get('window').height * 0.65
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold'
  },
  modalFooter: {
    alignItems: 'center'
  },
  closeModalButton: {
    marginTop: 20
  },
  modalActionIcons: {
    alignItems: 'center',
    flexDirection: 'row'
  },
  modalScrollContent: {
    flex: 1,
    marginTop: 10,
    marginBottom: 10
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
  historyHeaderText: {
    fontWeight: 'bold'
  },
  historyText: {},

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
