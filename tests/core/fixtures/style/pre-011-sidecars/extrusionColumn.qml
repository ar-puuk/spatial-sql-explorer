<!DOCTYPE qgis PUBLIC 'http://mrcc.com/qgis.dtd' 'SYSTEM'>
<qgis version="3.34.0" styleCategories="Symbology|Symbology3D|Rendering|CustomProperties">
  <renderer-v2 type="singleSymbol" symbollevels="0" forceraster="0" enableorderby="0" referencescale="-1">
    <symbols>
      <symbol type="fill" name="0" alpha="1" clip_to_extent="1" force_rhr="0">
        <layer class="SimpleFill" enabled="1" locked="0" pass="0">
          <Option type="Map">
            <Option name="color" type="QString" value="59,130,246,191"/>
            <Option name="joinstyle" type="QString" value="round"/>
            <Option name="outline_color" type="QString" value="75,85,99,204"/>
            <Option name="outline_style" type="QString" value="solid"/>
            <Option name="outline_width" type="QString" value="0.5"/>
            <Option name="outline_width_unit" type="QString" value="Pixel"/>
            <Option name="style" type="QString" value="solid"/>
          </Option>
        </layer>
      </symbol>
    </symbols>
    <rotation/>
    <sizescale/>
  </renderer-v2>
  <renderer-3d layer="" type="vector">
    <vector-layer-3d-tiling max-chunk-features="1000" show-bounding-boxes="0" zoom-levels-count="3"/>
    <symbol material_type="phong" type="polygon">
      <data add-back-faces="0" alt-binding="centroid" alt-clamping="absolute" culling-mode="no-culling" extrusion-height="0" invert-normals="0" offset="0" rendered-facade="Walls|Roof"/>
      <material ambient="59,130,246,255" diffuse="59,130,246,255" shininess="0" specular="255,255,255,255" opacity="1" type="phong"/>
      <data-defined-properties>
        <Option type="Map">
          <Option name="name" type="QString" value=""/>
          <Option name="properties" type="Map">
            <Option name="extrusionHeight" type="Map">
              <Option name="active" type="bool" value="true"/>
              <Option name="expression" type="QString" value="&quot;h&quot; * 2.5"/>
              <Option name="type" type="int" value="3"/>
            </Option>
          </Option>
          <Option name="type" type="QString" value="collection"/>
        </Option>
      </data-defined-properties>
      <edges color="0,0,0,255" enabled="0" width="1"/>
    </symbol>
  </renderer-3d>
  <layerOpacity>1</layerOpacity>
  <layerGeometryType>2</layerGeometryType>
</qgis>
