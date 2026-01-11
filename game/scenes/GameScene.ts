import Phaser from 'phaser';
import { Socket } from 'socket.io-client';
import { GAME_CONFIG } from '../config';

interface PlayerSprite {
  container: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Graphics;
  weapon: Phaser.GameObjects.Graphics;
  healthBar: Phaser.GameObjects.Graphics;
  healthBarBg: Phaser.GameObjects.Graphics;
  nameText: Phaser.GameObjects.Text;
  muzzleFlash?: Phaser.GameObjects.Graphics;
  data: any;
}

export class GameScene extends Phaser.Scene {
  private socket!: Socket;
  private playerId!: string;
  private players = new Map<string, PlayerSprite>();
  private bullets = new Map<number, Phaser.GameObjects.Graphics>();
  private safeZoneGraphics!: Phaser.GameObjects.Graphics;
  private nextSafeZoneGraphics!: Phaser.GameObjects.Graphics;

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: any;
  private keys!: any;

  private hudContainer!: Phaser.GameObjects.Container;
  private healthText!: Phaser.GameObjects.Text;
  private ammoText!: Phaser.GameObjects.Text;
  private killsText!: Phaser.GameObjects.Text;
  private weaponText!: Phaser.GameObjects.Text;
  private playersAliveText!: Phaser.GameObjects.Text;

  private killFeed: Phaser.GameObjects.Text[] = [];
  private hitMarkers: Phaser.GameObjects.Graphics[] = [];

  private moveVector = { x: 0, y: 0 };
  private lastMoveTime = 0;

  constructor() {
    super({ key: 'GameScene' });
  }

  init(data: { socket: Socket; playerId: string }) {
    this.socket = data.socket;
    this.playerId = data.playerId;
  }

  create() {
    this.cameras.main.setBackgroundColor(GAME_CONFIG.COLORS.MAP_BACKGROUND);
    this.cameras.main.setBounds(0, 0, GAME_CONFIG.MAP_SIZE, GAME_CONFIG.MAP_SIZE);
    this.cameras.main.setZoom(1);

    this.createMap();
    this.safeZoneGraphics = this.add.graphics();
    this.nextSafeZoneGraphics = this.add.graphics();

    this.setupInput();
    this.setupSocketListeners();
    this.createHUD();

    this.time.addEvent({
      delay: 16,
      callback: this.gameLoop,
      callbackScope: this,
      loop: true,
    });
  }

  createMap() {
    const graphics = this.add.graphics();
    graphics.fillStyle(0x3d5a27, 1);
    graphics.fillRect(0, 0, GAME_CONFIG.MAP_SIZE, GAME_CONFIG.MAP_SIZE);

    for (let i = 0; i < 30; i++) {
      const x = Math.random() * GAME_CONFIG.MAP_SIZE;
      const y = Math.random() * GAME_CONFIG.MAP_SIZE;
      const size = 40 + Math.random() * 60;

      graphics.fillStyle(0x78716c, 1);
      graphics.fillRect(x - size / 2, y - size / 2, size, size);
    }

    for (let i = 0; i < 50; i++) {
      const x = Math.random() * GAME_CONFIG.MAP_SIZE;
      const y = Math.random() * GAME_CONFIG.MAP_SIZE;
      const radius = 15 + Math.random() * 10;

      graphics.fillStyle(0x16a34a, 1);
      graphics.fillCircle(x, y, radius);
    }
  }

  createHUD() {
    this.hudContainer = this.add.container(0, 0);
    this.hudContainer.setScrollFactor(0);
    this.hudContainer.setDepth(1000);

    const hudBg = this.add.graphics();
    hudBg.fillStyle(0x000000, 0.5);
    hudBg.fillRoundedRect(10, 10, 250, 120, 8);
    this.hudContainer.add(hudBg);

    this.healthText = this.add.text(20, 20, 'Health: 100', {
      fontSize: '18px',
      color: '#10b981',
      fontStyle: 'bold',
    });
    this.hudContainer.add(this.healthText);

    this.ammoText = this.add.text(20, 45, 'Ammo: 12/12', {
      fontSize: '18px',
      color: '#fbbf24',
      fontStyle: 'bold',
    });
    this.hudContainer.add(this.ammoText);

    this.weaponText = this.add.text(20, 70, 'Weapon: Pistol', {
      fontSize: '16px',
      color: '#94a3b8',
    });
    this.hudContainer.add(this.weaponText);

    this.killsText = this.add.text(20, 95, 'Kills: 0', {
      fontSize: '16px',
      color: '#ef4444',
      fontStyle: 'bold',
    });
    this.hudContainer.add(this.killsText);

    this.playersAliveText = this.add.text(
      this.cameras.main.width - 150,
      20,
      'Alive: 0',
      {
        fontSize: '20px',
        color: '#ffffff',
        fontStyle: 'bold',
      }
    );
    this.playersAliveText.setScrollFactor(0);
    this.playersAliveText.setDepth(1000);
  }

  setupSocketListeners() {
    this.socket.off('gameState');
    this.socket.off('playerShot');
    this.socket.off('playerHit');
    this.socket.off('playerKilled');
    this.socket.off('matchEnd');

    this.socket.on('gameState', (state: any) => {
      this.updatePlayers(state.players);
      this.updateSafeZone(state.safeZone, state.nextSafeZone);
      this.playersAliveText.setText(`Alive: ${state.playersAlive}`);
    });

    this.socket.on('playerShot', (data: any) => {
      this.createBullets(data.bullets);
      const player = this.players.get(data.playerId);
      if (player) {
        this.showMuzzleFlash(player);
      }
    });

    this.socket.on('playerHit', (data: any) => {
      this.showHitEffect(data.targetId);
    });

    this.socket.on('playerKilled', (data: any) => {
      this.addKillFeed(`${data.killerName} killed ${data.victimName}`);
    });

    this.socket.on('matchEnd', (data: any) => {
      this.scene.start('GameOverScene', { winner: data.winner });
    });
  }

  setupInput() {
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = {
      W: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      A: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      S: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      D: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };

    this.keys = {
      ONE: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ONE),
      TWO: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.TWO),
      THREE: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.THREE),
      FOUR: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.FOUR),
      R: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.R),
    };

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.handleShoot(pointer);
    });

    this.keys.ONE.on('down', () => this.socket.emit('changeWeapon', { weapon: 'PISTOL' }));
    this.keys.TWO.on('down', () => this.socket.emit('changeWeapon', { weapon: 'AR' }));
    this.keys.THREE.on('down', () => this.socket.emit('changeWeapon', { weapon: 'SNIPER' }));
    this.keys.FOUR.on('down', () => this.socket.emit('changeWeapon', { weapon: 'SHOTGUN' }));
    this.keys.R.on('down', () => this.socket.emit('playerReload'));
  }

  handleShoot(pointer: Phaser.Input.Pointer) {
    const player = this.players.get(this.playerId);
    if (!player) return;

    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const angle = Phaser.Math.Angle.Between(
      player.container.x,
      player.container.y,
      world.x,
      world.y
    );

    this.socket.emit('playerShoot', { angle });
  }

  gameLoop() {
    this.handleMovement();
    this.updateBullets();
    this.updateHitMarkers();
  }

  handleMovement() {
    const player = this.players.get(this.playerId);
    if (!player || !player.data.isAlive) return;

    let vx = 0;
    let vy = 0;

    if (this.wasd.W.isDown || this.cursors.up?.isDown) vy -= 1;
    if (this.wasd.S.isDown || this.cursors.down?.isDown) vy += 1;
    if (this.wasd.A.isDown || this.cursors.left?.isDown) vx -= 1;
    if (this.wasd.D.isDown || this.cursors.right?.isDown) vx += 1;

    if (vx !== 0 || vy !== 0) {
      const length = Math.sqrt(vx * vx + vy * vy);
      vx /= length;
      vy /= length;

      this.moveVector.x = vx * GAME_CONFIG.PLAYER_SPEED;
      this.moveVector.y = vy * GAME_CONFIG.PLAYER_SPEED;

      const dt = 0.016;
      const newX = player.container.x + vx * GAME_CONFIG.PLAYER_SPEED * dt;
      const newY = player.container.y + vy * GAME_CONFIG.PLAYER_SPEED * dt;

      player.container.setPosition(newX, newY);

      this.animateWalking(player, vx, vy);

      const now = Date.now();
      if (now - this.lastMoveTime > 16) {
        this.socket.emit('playerMove', {
          x: newX,
          y: newY,
          velocityX: this.moveVector.x,
          velocityY: this.moveVector.y,
        });
        this.lastMoveTime = now;
      }
    } else {
      this.moveVector.x = 0;
      this.moveVector.y = 0;
    }

    const pointer = this.input.activePointer;
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const rotation = Phaser.Math.Angle.Between(
      player.container.x,
      player.container.y,
      world.x,
      world.y
    );

    player.weapon.setRotation(rotation);
    this.socket.emit('playerMove', { rotation });
  }

  animateWalking(player: PlayerSprite, vx: number, vy: number) {
    const time = Date.now();
    const wobble = Math.sin(time * 0.01) * 2;
    player.body.y = wobble;
  }

  createBullets(bullets: any[]) {
    bullets.forEach((bullet) => {
      const bulletGraphics = this.add.graphics();
      bulletGraphics.fillStyle(GAME_CONFIG.COLORS.BULLET, 1);
      bulletGraphics.fillCircle(0, 0, 4);
      bulletGraphics.setPosition(bullet.x, bullet.y);

      const trail = this.add.graphics();
      trail.lineStyle(2, GAME_CONFIG.COLORS.BULLET, 0.5);

      this.bullets.set(bullet.id, bulletGraphics);

      (bulletGraphics as any).bulletData = bullet;
      (bulletGraphics as any).trail = trail;
    });
  }

  updateBullets() {
    const dt = 0.016;

    this.bullets.forEach((graphics, id) => {
      const bullet = (graphics as any).bulletData;
      const trail = (graphics as any).trail;

      if (!bullet) {
        graphics.destroy();
        trail?.destroy();
        this.bullets.delete(id);
        return;
      }

      const oldX = bullet.x;
      const oldY = bullet.y;

      bullet.x += bullet.velocityX * dt;
      bullet.y += bullet.velocityY * dt;
      bullet.distanceTraveled += Math.sqrt(
        bullet.velocityX * bullet.velocityX + bullet.velocityY * bullet.velocityY
      ) * dt;

      graphics.setPosition(bullet.x, bullet.y);

      if (trail) {
        trail.clear();
        trail.lineStyle(2, GAME_CONFIG.COLORS.BULLET, 0.3);
        trail.lineBetween(oldX, oldY, bullet.x, bullet.y);
      }

      if (
        bullet.distanceTraveled > bullet.range ||
        bullet.x < 0 ||
        bullet.x > GAME_CONFIG.MAP_SIZE ||
        bullet.y < 0 ||
        bullet.y > GAME_CONFIG.MAP_SIZE
      ) {
        graphics.destroy();
        trail?.destroy();
        this.bullets.delete(id);
      }
    });
  }

  showMuzzleFlash(player: PlayerSprite) {
    if (player.muzzleFlash) {
      player.muzzleFlash.destroy();
    }

    const flash = this.add.graphics();
    flash.fillStyle(0xffff00, 0.8);
    flash.fillCircle(0, 0, 15);
    flash.setPosition(
      player.container.x + Math.cos(player.weapon.rotation) * 25,
      player.container.y + Math.sin(player.weapon.rotation) * 25
    );

    player.muzzleFlash = flash;

    this.time.delayedCall(50, () => {
      flash.destroy();
    });
  }

  showHitEffect(targetId: string) {
    const player = this.players.get(targetId);
    if (!player) return;

    const hitMarker = this.add.graphics();
    hitMarker.lineStyle(3, 0xff0000, 1);
    hitMarker.strokeCircle(player.container.x, player.container.y, 30);

    this.hitMarkers.push(hitMarker);

    this.time.delayedCall(200, () => {
      hitMarker.destroy();
      const index = this.hitMarkers.indexOf(hitMarker);
      if (index > -1) this.hitMarkers.splice(index, 1);
    });
  }

  updateHitMarkers() {
    this.hitMarkers.forEach((marker) => {
      marker.alpha -= 0.05;
      if (marker.alpha <= 0) {
        marker.destroy();
      }
    });
  }

  addKillFeed(message: string) {
    const y = 100 + this.killFeed.length * 30;
    const text = this.add.text(this.cameras.main.width - 300, y, message, {
      fontSize: '14px',
      color: '#ef4444',
      backgroundColor: '#000000',
      padding: { x: 8, y: 4 },
    });
    text.setScrollFactor(0);
    text.setDepth(1000);

    this.killFeed.push(text);

    this.time.delayedCall(5000, () => {
      text.destroy();
      const index = this.killFeed.indexOf(text);
      if (index > -1) this.killFeed.splice(index, 1);
    });
  }

  updatePlayers(playersData: any[]) {
    const currentIds = new Set(playersData.map((p) => p.id));

    for (const [id, playerSprite] of this.players) {
      if (!currentIds.has(id)) {
        playerSprite.container.destroy();
        this.players.delete(id);
      }
    }

    playersData.forEach((pData) => {
      if (!this.players.has(pData.id)) {
        const playerSprite = this.createPlayer(pData);
        this.players.set(pData.id, playerSprite);

        if (pData.id === this.playerId) {
          this.cameras.main.startFollow(playerSprite.container, true, 0.1, 0.1);
        }
      } else {
        const playerSprite = this.players.get(pData.id)!;

        if (pData.id !== this.playerId) {
          playerSprite.container.setPosition(pData.x, pData.y);
          playerSprite.weapon.setRotation(pData.rotation);
        }

        this.updatePlayerVisuals(playerSprite, pData);
      }
    });
  }

  createPlayer(data: any): PlayerSprite {
    const container = this.add.container(data.x, data.y);

    const body = this.add.graphics();
    const isOwn = data.id === this.playerId;
    const color = isOwn ? GAME_CONFIG.COLORS.PLAYER_SELF : GAME_CONFIG.COLORS.PLAYER_OTHER;

    body.fillStyle(color, 1);
    body.fillCircle(0, 0, 12);

    body.lineStyle(2, 0x000000, 1);
    body.strokeCircle(0, 0, 12);

    const weapon = this.add.graphics();
    weapon.fillStyle(0x1f2937, 1);
    weapon.fillRect(0, -3, 25, 6);
    weapon.setRotation(data.rotation || 0);

    const nameText = this.add.text(0, -35, data.username, {
      fontSize: '12px',
      color: '#ffffff',
      backgroundColor: '#000000',
      padding: { x: 4, y: 2 },
    });
    nameText.setOrigin(0.5, 0.5);

    const healthBarBg = this.add.graphics();
    healthBarBg.fillStyle(0x000000, 0.5);
    healthBarBg.fillRect(-20, -25, 40, 4);

    const healthBar = this.add.graphics();
    this.updateHealthBar(healthBar, data.health);

    container.add([body, weapon, healthBarBg, healthBar, nameText]);

    return {
      container,
      body,
      weapon,
      healthBar,
      healthBarBg,
      nameText,
      data,
    };
  }

  updatePlayerVisuals(playerSprite: PlayerSprite, data: any) {
    playerSprite.data = data;

    this.updateHealthBar(playerSprite.healthBar, data.health);

    if (!data.isAlive) {
      playerSprite.body.clear();
      playerSprite.body.fillStyle(GAME_CONFIG.COLORS.PLAYER_DEAD, 0.5);
      playerSprite.body.fillCircle(0, 0, 12);
      playerSprite.weapon.setVisible(false);
    }

    if (data.id === this.playerId) {
      this.healthText.setText(`Health: ${Math.floor(data.health)}`);
      const ammoDisplay = data.isReloading ? 'Reloading...' : `${data.ammo}/${data.maxAmmo}`;
      this.ammoText.setText(`Ammo: ${ammoDisplay}`);
      this.weaponText.setText(`Weapon: ${this.getWeaponName(data.weapon)}`);
      this.killsText.setText(`Kills: ${data.kills}`);
    }
  }

  updateHealthBar(graphics: Phaser.GameObjects.Graphics, health: number) {
    graphics.clear();
    const width = 40 * (health / 100);
    const color = health > 60 ? 0x10b981 : health > 30 ? 0xfbbf24 : 0xef4444;
    graphics.fillStyle(color, 1);
    graphics.fillRect(-20, -25, width, 4);
  }

  getWeaponName(weapon: string): string {
    const names: any = {
      PISTOL: 'Pistol',
      AR: 'Assault Rifle',
      SNIPER: 'Sniper',
      SHOTGUN: 'Shotgun',
    };
    return names[weapon] || weapon;
  }

  updateSafeZone(zone: any, nextZone: any) {
    this.safeZoneGraphics.clear();
    this.nextSafeZoneGraphics.clear();

    if (!zone) return;

    this.safeZoneGraphics.lineStyle(4, GAME_CONFIG.COLORS.SAFE_ZONE, 0.8);
    this.safeZoneGraphics.strokeCircle(zone.x, zone.y, zone.radius);

    if (nextZone) {
      this.nextSafeZoneGraphics.lineStyle(3, GAME_CONFIG.COLORS.NEXT_SAFE_ZONE, 0.5);
      this.nextSafeZoneGraphics.strokeCircle(nextZone.x, nextZone.y, nextZone.radius);
    }
  }
}
