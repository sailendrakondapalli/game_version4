const config = require('./config');

class GameManager {
  constructor(matchId) {
    this.matchId = matchId;
    this.players = new Map();
    this.bullets = [];
    this.healthKits = [];
    this.safeZone = {
      x: config.MAP_SIZE / 2,
      y: config.MAP_SIZE / 2,
      radius: config.MAP_SIZE / 2,
    };
    this.nextSafeZone = null;
    this.shrinkStartTime = null;
    this.isActive = false;
    this.startTime = null;
    this.playersAlive = 0;
    this.lastBulletId = 0;
  }

  addPlayer(socketId, playerData) {
    const spawnPoint = this.getRandomSpawnPoint();
    this.players.set(socketId, {
      id: socketId,
      playerId: playerData.playerId,
      username: playerData.username,
      x: spawnPoint.x,
      y: spawnPoint.y,
      rotation: 0,
      health: 100,
      armor: 0,
      isAlive: true,
      weapon: 'PISTOL',
      weaponRange: config.WEAPONS.PISTOL.range,
      ammo: config.WEAPONS.PISTOL.magazineSize,
      maxAmmo: config.WEAPONS.PISTOL.magazineSize,
      isReloading: false,
      kills: 0,
      damage: 0,
      velocityX: 0,
      velocityY: 0,
      lastShootTime: 0,
    });
    this.playersAlive++;
  }

  spawnHealthKits(count = 5) {
    this.healthKits = [];
    const margin = 150;
    for (let i = 0; i < count; i++) {
      this.healthKits.push({
        id: i + 1,
        x: margin + Math.random() * (config.MAP_SIZE - margin * 2),
        y: margin + Math.random() * (config.MAP_SIZE - margin * 2),
      });
    }
  }

 pickupHealthKit(socketId) {
  const player = this.players.get(socketId);
  if (!player || !player.isAlive || player.health >= 100) return null;

  for (let i = 0; i < this.healthKits.length; i++) {
    const kit = this.healthKits[i];
    const dx = player.x - kit.x;
    const dy = player.y - kit.y;

    if (Math.sqrt(dx * dx + dy * dy) < 30) {
      player.health = Math.min(100, player.health + 50);
      this.healthKits.splice(i, 1);
      return { kitId: kit.id, health: player.health };
    }
  }
  return null;
}


  removePlayer(socketId) {
    const player = this.players.get(socketId);
    if (player && player.isAlive) {
      this.playersAlive--;
    }
    this.players.delete(socketId);
  }

  updatePlayer(socketId, data) {
    const player = this.players.get(socketId);
    if (!player || !player.isAlive) return;

    if (data.x !== undefined && data.y !== undefined) {
      const dx = data.x - player.x;
      const dy = data.y - player.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance > config.MAX_VELOCITY * 0.05) return;

      player.x = Math.max(0, Math.min(config.MAP_SIZE, data.x));
      player.y = Math.max(0, Math.min(config.MAP_SIZE, data.y));
    }

    if (data.rotation !== undefined) player.rotation = data.rotation;
    if (data.velocityX !== undefined) player.velocityX = data.velocityX;
    if (data.velocityY !== undefined) player.velocityY = data.velocityY;
  }

  handleShoot(socketId, data) {
    const player = this.players.get(socketId);
    if (!player || !player.isAlive || player.isReloading) return null;

    const now = Date.now();
    const weapon = config.WEAPONS[player.weapon];

    if (now - player.lastShootTime < weapon.fireRate) return null;
    if (player.ammo <= 0) {
      this.handleReload(socketId);
      return null;
    }

    player.ammo--;
    player.lastShootTime = now;

    const bullets = [];
    const pelletCount = weapon.pellets || 1;

    for (let i = 0; i < pelletCount; i++) {
      const spread = weapon.pellets ? (Math.random() - 0.5) * 0.3 : 0;
      const angle = data.angle + spread;

      const bullet = {
        id: ++this.lastBulletId,
        x: player.x,
        y: player.y,
        angle,
        velocityX: Math.cos(angle) * weapon.bulletSpeed,
        velocityY: Math.sin(angle) * weapon.bulletSpeed,
        ownerId: socketId,
        weapon: player.weapon,
        damage: weapon.damage,
        range: config.WEAPONS[player.weapon].range,
        distanceTraveled: 0,
      };

      this.bullets.push(bullet);
      bullets.push(bullet);
    }

    return { playerId: socketId, bullets, ammo: player.ammo };
  }

  handleReload(socketId) {
    const player = this.players.get(socketId);
    if (!player || !player.isAlive || player.isReloading) return;

    player.isReloading = true;
    const weapon = config.WEAPONS[player.weapon];

    setTimeout(() => {
      if (this.players.has(socketId)) {
        player.ammo = weapon.magazineSize;
        player.maxAmmo = weapon.magazineSize;
        player.isReloading = false;
      }
    }, weapon.reloadTime);
  }

  changeWeapon(socketId, weaponType) {
    const player = this.players.get(socketId);
    if (!player || !player.isAlive || !config.WEAPONS[weaponType]) return;

    const weaponConfig = config.WEAPONS[weaponType];
    player.weapon = weaponType;
    player.ammo = weaponConfig.magazineSize;
    player.maxAmmo = weaponConfig.magazineSize;
    player.isReloading = false;
    player.weaponRange = weaponConfig.range; // Update weapon range dynamically
  }

  update(deltaTime) {
    const hits = this.updateBullets(deltaTime);
    const zoneDeaths = this.checkSafeZone();

    const allHits = [];
    if (hits) allHits.push(...hits);
    if (zoneDeaths) {
      zoneDeaths.forEach(death => {
        allHits.push({
          targetId: death.victimId,
          killed: true,
          victimId: death.victimId,
          victimName: death.victimName,
          killerId: null,
          killerName: 'Safe Zone',
        });
      });
    }

    return {
      gameState: this.getGameState(),
      hits: allHits.length ? allHits : null,
    };
  }

  updateBullets(deltaTime) {
    const dt = deltaTime / 1000;
    const hits = [];

    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const bullet = this.bullets[i];

      bullet.x += bullet.velocityX * dt;
      bullet.y += bullet.velocityY * dt;
      bullet.distanceTraveled += Math.sqrt(
        bullet.velocityX * bullet.velocityX + bullet.velocityY * bullet.velocityY
      ) * dt;

      if (
        bullet.x < 0 || bullet.x > config.MAP_SIZE ||
        bullet.y < 0 || bullet.y > config.MAP_SIZE ||
        bullet.distanceTraveled > bullet.range
      ) {
        this.bullets.splice(i, 1);
        continue;
      }

      for (const [socketId, player] of this.players) {
        if (socketId === bullet.ownerId || !player.isAlive) continue;

        const dx = player.x - bullet.x;
        const dy = player.y - bullet.y;

        if (Math.sqrt(dx * dx + dy * dy) < 20) {
          const hit = this.handleHit(socketId, bullet);
          if (hit) hits.push({ targetId: socketId, ...hit });
          this.bullets.splice(i, 1);
          break;
        }
      }
    }
    return hits;
  }

  handleHit(targetSocketId, bullet) {
    const target = this.players.get(targetSocketId);
    const attacker = this.players.get(bullet.ownerId);

    if (!target || !target.isAlive) return null;

    let damage = bullet.damage;

    if (target.armor > 0) {
      const armorAbsorb = Math.min(damage * 0.5, target.armor);
      target.armor -= armorAbsorb;
      damage -= armorAbsorb;
    }

    target.health -= damage;

    if (attacker) attacker.damage += damage;

    if (target.health <= 0) {
      target.health = 0;
      target.isAlive = false;
      this.playersAlive--;
      if (attacker) attacker.kills++;

      return {
        killed: true,
        killerId: bullet.ownerId,
        killerName: attacker ? attacker.username : 'Unknown',
        victimId: targetSocketId,
        victimName: target.username,
      };
    }

    return {
      killed: false,
      killerId: bullet.ownerId,
      killerName: attacker ? attacker.username : 'Unknown',
      victimId: targetSocketId,
      victimName: target.username,
    };
  }

  checkSafeZone() {
    if (!this.isActive) return null;

    const now = Date.now();

    if (!this.shrinkStartTime) {
      this.shrinkStartTime = now + config.SAFE_ZONE_SHRINK_INTERVAL;
      this.nextSafeZone = {
        x: config.MAP_SIZE / 2 + (Math.random() - 0.5) * config.MAP_SIZE * 0.3,
        y: config.MAP_SIZE / 2 + (Math.random() - 0.5) * config.MAP_SIZE * 0.3,
        radius: this.safeZone.radius * 0.6,
      };
      return null;
    }

    if (now >= this.shrinkStartTime && this.nextSafeZone) {
      this.safeZone = this.nextSafeZone;
      this.shrinkStartTime = now + config.SAFE_ZONE_SHRINK_INTERVAL;

      if (this.safeZone.radius > 100) {
        this.nextSafeZone = {
          x: this.safeZone.x + (Math.random() - 0.5) * this.safeZone.radius * 0.3,
          y: this.safeZone.y + (Math.random() - 0.5) * this.safeZone.radius * 0.3,
          radius: this.safeZone.radius * 0.7,
        };
      } else {
        this.nextSafeZone = null;
      }
    }

    const damages = [];
    for (const [socketId, player] of this.players) {
      if (!player.isAlive) continue;

      const dx = player.x - this.safeZone.x;
      const dy = player.y - this.safeZone.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance > this.safeZone.radius) {
        player.health -= config.SAFE_ZONE_DAMAGE;
        if (player.health <= 0) {
          player.health = 0;
          player.isAlive = false;
          this.playersAlive--;
          damages.push({
            victimId: socketId,
            victimName: player.username,
            reason: 'safe zone',
          });
        }
      }
    }

    return damages.length ? damages : null;
  }

  startSafeZoneShrink() {
    this.shrinkStartTime = Date.now() + config.SAFE_ZONE_SHRINK_INTERVAL;
  }

  getGameState() {
    const players = [];
    for (const [socketId, player] of this.players) {
      players.push({
        id: socketId,
        username: player.username,
        x: player.x,
        y: player.y,
        rotation: player.rotation,
        health: player.health,
        armor: player.armor,
        isAlive: player.isAlive,
        weapon: player.weapon,
        ammo: player.ammo,
        maxAmmo: player.maxAmmo,
        isReloading: player.isReloading,
        kills: player.kills,
      });
    }

    return {
      players,
      safeZone: this.safeZone,
      nextSafeZone: this.nextSafeZone,
      playersAlive: this.playersAlive,
      healthKits: this.healthKits, // ⭐ ADDED
    };
  }

  getRandomSpawnPoint() {
    const margin = 200;
    return {
      x: margin + Math.random() * (config.MAP_SIZE - margin * 2),
      y: margin + Math.random() * (config.MAP_SIZE - margin * 2),
    };
  }

  getWinner() {
    if (this.playersAlive !== 1) return null;

    for (const [socketId, player] of this.players) {
      if (player.isAlive) {
        return {
          socketId,
          playerId: player.playerId,
          username: player.username,
          kills: player.kills,
          damage: player.damage,
        };
      }
    }
    return null;
  }

  start() {
    this.isActive = true;
    this.startTime = Date.now();
    this.startSafeZoneShrink();
    this.spawnHealthKits(); // ⭐ ADDED
  }
}

module.exports = GameManager;
