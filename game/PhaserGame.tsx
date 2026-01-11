import { useEffect, useRef } from 'react';
import { View, Platform } from 'react-native';
import Phaser from 'phaser';
import { Socket } from 'socket.io-client';
import { GameScene } from './scenes/GameScene';
import { GameOverScene } from './scenes/GameOverScene';

interface Props {
  socket: Socket;
  playerId: string;
  matchCode: string;
}

export default function PhaserGame({ socket, playerId }: Props) {
  const gameRef = useRef<Phaser.Game | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') return;

    if (gameRef.current) {
      gameRef.current.destroy(true);
      gameRef.current = null;
    }

    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.AUTO,
      parent: 'phaser-game',
      width: window.innerWidth,
      height: window.innerHeight,
      scene: [GameScene, GameOverScene],
    };

    const game = new Phaser.Game(config);
    gameRef.current = game;

    game.scene.start('GameScene', { socket, playerId });

    console.log('🎮 Starting GameScene with', socket.id, playerId);

    return () => {
      game.destroy(true);
      gameRef.current = null;
    };
  }, [socket, playerId]);

  return (
    <View style={{ flex: 1 }}>
      <div id="phaser-game" style={{ width: '100%', height: '100%' }} />
    </View>
  );
}
