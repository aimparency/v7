import * as vec2 from './vec2'

const SQR_3_4 = Math.sqrt(3/4); 

const arrowWidth = 0.66

function rotCW(v: vec2.T) {
  return vec2.fromValues(v[1], -v[0])
}

function makeCircularPath(
  from: {pos: vec2.T, r: number}, 
  width: number, 
  into: {pos: vec2.T, r: number}
) : string {
  const delta = vec2.crSub(into.pos, from.pos)
  const R = vec2.len(delta)

  if(R < from.r + into.r) {
    return ""
  } else {
    const deltaRot = rotCW(delta)
    vec2.scale(deltaRot, deltaRot, SQR_3_4) 

    // point beween from and into
    const halfWay = vec2.crAdd(from.pos, into.pos) 
    vec2.scale(halfWay, halfWay, 0.5)

    // center point of arc
    const M = vec2.crAdd(halfWay, deltaRot)

    const getMNorm = (point: vec2.T) : vec2.T => {
      let result = vec2.crSub(point, M) 
      vec2.normalize(result, result) 
      return result
    }

    const getArcPoint = (radius: number) : vec2.T => {
      const a = Math.pow(radius, 2) / (2 * R)
      const h = Math.sqrt(Math.pow(radius, 2) - Math.pow(a, 2))

      const normMToInto = getMNorm(into.pos)
      const normMToIntoRot = rotCW(normMToInto)

      vec2.scale(normMToInto, normMToInto, a) 
      vec2.scale(normMToIntoRot, normMToIntoRot, h)

      const result = vec2.clone(into.pos)
      vec2.sub(result, result, normMToInto) 
      vec2.sub(result, result, normMToIntoRot) 
      return result
    }

    const arrowPeak = getArcPoint(into.r); 

    const arrowWings = getArcPoint(into.r + width * 1)
    const normMToArrowWings = getMNorm(arrowWings)
    const normMToArrowWingsRot = rotCW(normMToArrowWings)

    const toFarWingSide = vec2.crScale(normMToArrowWings, width * 1)
    const toNearWingSide = vec2.crScale(normMToArrowWings, width * 0.5) 

    const wingOuterFar = vec2.crAdd(arrowWings, toFarWingSide) 
    const wingOuterNear = vec2.crAdd(arrowWings, toNearWingSide);
    const wingInnerFar = vec2.crSub(arrowWings, toFarWingSide);
    const wingInnerNear = vec2.crSub(arrowWings, toNearWingSide); 

    const normMToMFrom = getMNorm(from.pos); 
    const toTheSide = vec2.crScale(normMToMFrom, width); 
    const startOuter = vec2.crAdd(from.pos, toTheSide); 
    const startInner = vec2.crSub(from.pos, toTheSide); 

    const normMToMFromRot = rotCW(normMToMFrom); 

    const outerDistance = vec2.dist(wingOuterNear, startOuter) * 0.34
    const h1 = vec2.crScale(normMToArrowWingsRot, outerDistance)
    const h2 = vec2.crScale(normMToMFromRot, outerDistance)
    const outerWingControl = vec2.crSub(wingOuterNear, h1) 
    const outerStartControl = vec2.crAdd(startOuter, h2) 


    const innerDistance = vec2.dist(wingInnerNear, startInner) * 0.34
    const h3 = vec2.crScale(normMToArrowWingsRot, innerDistance)
    const h4 = vec2.crScale(normMToMFromRot, innerDistance)
    const innerWingControl = vec2.crSub(wingInnerNear, h3) 
    const innerStartControl = vec2.crAdd(startInner, h4) 



    const pathSpec = [
      'M', startInner, 
      'C', innerStartControl, innerWingControl, wingInnerNear,  
      'L', wingInnerFar, 
      'L', arrowPeak, 
      'L', wingOuterFar, 
      'L', wingOuterNear, 
      'C', outerWingControl, outerStartControl, startOuter, 
    ]

    let widthWithStroke = width * 1.1
    if(widthWithStroke > from.r) {
      let arcR = width * 1.001
      pathSpec.push(`A ${arcR} ${arcR} 0 0 1 ${startInner[0]} ${startInner[1]}`)
    }
    pathSpec.push('Z') 


    return pathSpec.map(c => {
      if((typeof c) == "string") {
        return c
      } else {
        return `${c[0]} ${c[1]}`
      } 
    }).join(' ') 
  }
}

export default makeCircularPath
